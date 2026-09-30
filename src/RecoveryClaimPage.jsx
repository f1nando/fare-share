import { useEffect, useMemo, useState } from 'react';
import {
  claimMachine,
  connectWallet,
  disconnectWallet,
  explorerTransaction,
  shortAddress,
} from './protocol/solana.js';
import {
  RECOVERY_ASSET,
  RECOVERY_OWNER,
  RECOVERY_PROGRAM_ID,
  loadRecoveryClaimState,
} from './recoveryClaim.js';
import { notifyError, notifySuccess } from './siteToasts.jsx';

const SYMBOLS = ['$TAXI', 'UBERx', 'TSLAx', 'GOOGLx', 'AMZNx'];

export function RecoveryClaimPage() {
  const [wallet, setWallet] = useState(null);
  const [claimState, setClaimState] = useState(null);
  const [notice, setNotice] = useState('Loading finalized Mainnet state…');
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState('');

  const refresh = async () => {
    const next = await loadRecoveryClaimState();
    setClaimState(next);
    setNotice('Finalized Mainnet state verified.');
    return next;
  };

  useEffect(() => {
    let active = true;
    loadRecoveryClaimState()
      .then(next => {
        if (!active) return;
        setClaimState(next);
        setNotice('Finalized Mainnet state verified.');
      })
      .catch(error => active && setNotice(error.message));
    const timer = window.setInterval(() => {
      loadRecoveryClaimState().then(next => active && setClaimState(next)).catch(() => undefined);
    }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const walletAddress = wallet ? String(wallet.account.address) : '';
  const correctWallet = walletAddress === RECOVERY_OWNER;
  const rewards = claimState?.machine?.rewards || [];
  const hasRewards = rewards.some(amount => BigInt(amount) > 0n);
  const canClaim = correctWallet && hasRewards && !busy;
  const rewardRows = useMemo(() => SYMBOLS.map((symbol, index) => ({
    symbol,
    amount: rewards[index]?.toString() || '0',
  })), [rewards]);

  async function connect() {
    if (wallet) {
      await disconnectWallet(wallet);
      setWallet(null);
      setNotice('Wallet disconnected.');
      return;
    }
    const connected = await connectWallet();
    setWallet(connected);
    const connectedAddress = String(connected.account.address);
    setNotice(connectedAddress === RECOVERY_OWNER
      ? 'Correct owner wallet connected.'
      : `Wrong wallet. Connect ${shortAddress(RECOVERY_OWNER)} to continue.`);
  }

  async function claim() {
    if (!canClaim) return;
    setBusy(true);
    setSignature('');
    setNotice('Review one Claim transaction in your wallet. No NFT transfer or burn is included.');
    try {
      const result = await claimMachine(wallet, claimState.machine, claimState.status);
      setSignature(result);
      const next = await refresh();
      const remaining = next.machine.rewards.some(amount => BigInt(amount) > 0n);
      const message = remaining
        ? 'Transaction finalized, but rewards remain. Do not close this page.'
        : 'Claim finalized. All recorded rewards for this taxi are now zero.';
      setNotice(message);
      notifySuccess(message);
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      const message = error.message || 'Claim failed. Nothing should be retried until the transaction status is checked.';
      setNotice(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="recovery-page">
      <section className="recovery-card">
        <div className="recovery-mark">FARE SHARE · MAINNET RECOVERY</div>
        <h1>FINAL REWARD CLAIM</h1>
        <p className="recovery-lead">This isolated page can perform one action only: claim the remaining rewards belonging to the verified owner of one test taxi.</p>

        <div className="recovery-warning">
          <strong>Do not share your seed phrase.</strong>
          <span>The website never asks for it. Your wallet should display one Solana transaction and a small network fee.</span>
        </div>

        <dl className="recovery-identities">
          <div><dt>Required wallet</dt><dd>{RECOVERY_OWNER}</dd></div>
          <div><dt>Program</dt><dd>{RECOVERY_PROGRAM_ID}</dd></div>
          <div><dt>Taxi asset</dt><dd>{RECOVERY_ASSET}</dd></div>
        </dl>

        <div className="recovery-state-grid">
          <div><span>Wallet</span><strong>{wallet ? shortAddress(walletAddress) : 'Not connected'}</strong><small>{wallet ? (correctWallet ? 'Verified owner' : 'Wrong wallet') : 'Connect the required wallet'}</small></div>
          <div><span>Protocol</span><strong>{claimState ? 'Claim window open' : 'Checking'}</strong><small>Verified by the admin instruction preflight</small></div>
          <div><span>Claim state</span><strong>{claimState ? (hasRewards ? 'Rewards available' : 'Complete') : 'Checking'}</strong><small>Read from finalized Solana accounts</small></div>
        </div>

        <div className="recovery-rewards">
          <h2>Exact raw rewards</h2>
          {rewardRows.map(row => <div key={row.symbol}><span>{row.symbol}</span><strong>{row.amount}</strong></div>)}
        </div>

        <p className={`recovery-notice${correctWallet ? ' is-ready' : ''}`} role="status">{notice}</p>
        {signature && <a className="recovery-signature" href={explorerTransaction(signature)} target="_blank" rel="noreferrer">View finalized transaction on Solscan</a>}

        <div className="recovery-actions">
          <button type="button" className="recovery-connect" onClick={() => connect().catch(error => { setNotice(error.message); notifyError(error.message); })}>{wallet ? 'Disconnect wallet' : 'Connect wallet'}</button>
          <button type="button" className="recovery-claim" disabled={!canClaim} onClick={claim}>{busy ? 'Waiting for finalization…' : hasRewards ? 'Claim rewards' : 'Claim complete'}</button>
        </div>

        <ol className="recovery-steps">
          <li>Connect exactly <b>{shortAddress(RECOVERY_OWNER)}</b>.</li>
          <li>Wait until “Claim window open” appears.</li>
          <li>Verify the wallet transaction is a Fare Share Claim, then approve it.</li>
          <li>Keep this page open until the finalized confirmation appears.</li>
        </ol>
      </section>
    </main>
  );
}
