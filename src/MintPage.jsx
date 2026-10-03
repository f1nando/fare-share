import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import traineeDrivingScene from './traineeDrivingScene.json';
import { appAssetPath } from './appPath.js';
import { MintRevealModal } from './MintRevealModal.jsx';
import { formatCompactNumber } from './compactNumber.js';
import {
  activateTrainee,
  claimTrainee,
  ensureFareTokenAccount,
  explorerTransaction,
  formatTokenAmount,
  loadOwnedTrainees,
  loadProtocolStatus,
  mintMachine,
  prepareMintQuote,
  waitForTransaction,
} from './protocol/solana.js';
import { loadDatabaseFleet, loadPublicMarket, loadPublicOverview, saveMintToDatabase } from './publicData.js';
import { useTokenConfig } from './tokenConfig.jsx';
import { executeTrade, quoteMintFarePurchase, quoteTrade } from './tradeApi.js';
import { dismissToast, notifyError, notifyLoading, notifySuccess } from './siteToasts.js';

const MINT_CLASSES = [
  { name: 'Economy', tone: 'economy', weight: 1, supply: 833, sceneNames: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'] },
  { name: 'Comfort', tone: 'comfort', weight: 3, supply: 278, sceneNames: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'] },
  { name: 'Business', tone: 'business', weight: 10, supply: 83, sceneNames: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'] },
  { name: 'Legend', tone: 'legend', weight: 30, supply: 28, sceneNames: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'] },
].map(item => ({
  ...item,
  scenes: item.sceneNames.map(name => drivingScenes.find(car => car.name === name)).filter(Boolean),
}));

const PREVIEW_ITEMS = [
  ...MINT_CLASSES.flatMap(item => item.scenes.map(scene => ({ scene, label: item.name, tone: item.tone }))),
  { scene: traineeDrivingScene, label: 'Trainee', tone: 'trainee' },
];
const PRIMARY_TRAINEE_CAMPAIGN_ID = 1n;

function formatUsdCents(cents) {
  return `$${formatCompactNumber(Number(cents) / 100)}`;
}

function previewReducer(state) {
  let order = state.order;
  let cursor = state.cursor + 1;
  if (cursor >= order.length) {
    order = shuffledPreviewOrder();
    cursor = 0;
    if (order[0] === state.currentIndex && order.length > 1) [order[0], order[1]] = [order[1], order[0]];
  }
  return {
    order,
    cursor,
    previousIndex: state.currentIndex,
    currentIndex: order[cursor],
  };
}

function shuffledPreviewOrder() {
  const order = PREVIEW_ITEMS.map((_item, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function createPreviewState() {
  const order = shuffledPreviewOrder();
  return { order, cursor: 0, previousIndex: null, currentIndex: order[0] };
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14.707 15V1H.707M14.707 1L.707 15" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function MintPage({ wallet, connectWallet }) {
  const tokenConfig = useTokenConfig();
  const ticker = tokenConfig.ticker || '';
  const previewRef = useRef(null);
  const quantity = 1;
  const [isPreviewHovered, setIsPreviewHovered] = useState(false);
  const [status, setStatus] = useState(null);
  const [databaseMint, setDatabaseMint] = useState(null);
  const [notice, setNotice] = useState('Loading live Solana mint state…');
  const [busy, setBusy] = useState(false);
  const [buyBusy, setBuyBusy] = useState(false);
  const [signature, setSignature] = useState('');
  const [preparedMint, setPreparedMint] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [trainees, setTrainees] = useState([]);
  const [keyword, setKeyword] = useState('TAXI');
  const [traineeBusy, setTraineeBusy] = useState('');
  const [traineeNotice, setTraineeNotice] = useState('');
  const [traineeSignature, setTraineeSignature] = useState('');
  const [mintReveal, setMintReveal] = useState(null);
  const [preview, dispatchPreview] = useReducer(previewReducer, undefined, createPreviewState);
  const selectedPreview = PREVIEW_ITEMS[preview.currentIndex];
  const onchainMintedByClass = status?.config?.mintedByClass;
  const remainingLoaded = onchainMintedByClass?.length === 4 || databaseMint?.mintedByClass?.length === 4;
  const mintedByClass = (onchainMintedByClass?.length === 4
    ? onchainMintedByClass
    : databaseMint?.mintedByClass?.length === 4 ? databaseMint.mintedByClass : [0, 0, 0, 0]
  ).map(Number);
  const totalMinted = mintedByClass.reduce((total, value) => total + value, 0);
  const remaining = Math.max(0, 1222 - totalMinted);
  const priceUsdCents = databaseMint?.mintPricesUsdCents?.[0] ? BigInt(databaseMint.mintPricesUsdCents[0]) : 0n;
  const fareDecimals = Number(databaseMint?.fareDecimals ?? 0);
  const fareTicker = ticker || 'FARE';
  const paused = Boolean(databaseMint?.paused);
  const hasQuotedBalance = !preparedMint || preparedMint.ownerFareBalance >= BigInt(preparedMint.quote.amountFareRaw) * BigInt(quantity);
  const missingFareRaw = preparedMint && !hasQuotedBalance
    ? BigInt(preparedMint.quote.amountFareRaw) * BigInt(quantity) - preparedMint.ownerFareBalance
    : 0n;

  useEffect(() => {
    let active = true;
    Promise.all([loadProtocolStatus(), loadPublicOverview()])
      .then(([next, overview]) => {
        if (!active) return;
        setStatus(next);
        setDatabaseMint(overview.mint);
        setNotice(next.deployed && overview.mint?.saleStarted ? '' : 'The mint program is not available.');
      })
      .catch(error => active && setNotice(error.message || 'Could not load the live mint state.'));
    return () => { active = false; };
  }, [tokenConfig.mint]);

  useEffect(() => {
    if (!wallet || !status?.deployed || paused || remaining === 0) {
      setPreparedMint(null);
      return undefined;
    }
    let active = true;
    let timer;
    const refresh = () => prepareMintQuote(wallet, status)
      .then(value => {
        if (!active) return;
        setPreparedMint(value);
        setQuoteError('');
        const refreshMs = Math.max(1_000, Number(BigInt(value.quote.expiresAt) * 1_000n - BigInt(Date.now()) - 5_000n));
        timer = window.setTimeout(refresh, refreshMs);
      })
      .catch(error => {
        if (!active) return;
        setPreparedMint(null);
        setQuoteError(error.message || 'A safe FARE quote is unavailable.');
      });
    refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [wallet, status?.deployed, status?.config?.fareMint, paused, remaining]);

  useEffect(() => {
    if (!wallet || !status?.deployed) {
      setTrainees([]);
      setKeyword('TAXI');
      return undefined;
    }
    let active = true;
    loadOwnedTrainees(wallet.account.address, status)
      .then(value => {
        if (!active) return;
        setTrainees(value);
        setKeyword(value.some(trainee => trainee.campaignId === PRIMARY_TRAINEE_CAMPAIGN_ID) ? '' : 'TAXI');
      })
      .catch(error => active && setTraineeNotice(error.message));
    return () => { active = false; };
  }, [wallet, status]);

  async function handleMint() {
    if (!status?.deployed) return showMintError('The mint program is not available.');
    if (paused) return showMintError('The protocol is paused. Minting is temporarily disabled.');
    if (remaining === 0) return showMintError('The taxi collection is sold out.');
    setBusy(true);
    setSignature('');
    setNotice('Approve the transaction in Phantom…');
    const toastId = notifyLoading('Minting your taxi NFT…');
    let lastSignature = '';
    let mintedCount = 0;
    try {
      const connection = wallet || await connectWallet();
      const result = await mintMachine(connection, status, preparedMint);
      lastSignature = result.signature;
      mintedCount = 1;
      setSignature(lastSignature);
      const indexedMint = await saveMintToDatabase({
        signature: result.signature,
        asset: String(result.asset),
        owner: String(connection.account.address),
      }, {
        attempts: 4,
        pollMs: 1_000,
        onPending: () => {
          const message = 'Minted, indexing your taxi…';
          setNotice(message);
          notifyLoading(message, { id: toastId });
        },
      });
      setDatabaseMint((await loadPublicOverview()).mint);
      setStatus(await loadProtocolStatus());
      setPreparedMint(null);
      setSignature(lastSignature);
      const reveal = indexedMint.indexed
        ? await loadMintReveal(String(connection.account.address), String(result.asset))
        : null;
      if (reveal) setMintReveal(reveal);
      const message = indexedMint.indexed
        ? 'Taxi NFT minted and added to your fleet.'
        : 'Taxi NFT minted. Fleet indexing is still in progress.';
      setNotice(message);
      if (reveal) dismissToast(toastId);
      else notifySuccess(message, { id: toastId });
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      const message = mintedCount
        ? `${mintedCount} taxi${mintedCount === 1 ? '' : 's'} minted onchain, but database synchronization needs to retry: ${error.message || 'unknown error'}`
        : error.message || 'Mint failed.';
      setNotice(message);
      notifyError(message, { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  async function handleBuyMissingFare() {
    if (!preparedMint || missingFareRaw <= 0n) return;
    setBuyBusy(true);
    setSignature('');
    setNotice(`Preparing the ${fareTicker} purchase…`);
    const toastId = notifyLoading(`Preparing your ${fareTicker} purchase…`);
    try {
      const connection = wallet || await connectWallet();
      if (!preparedMint.ownerFareAccountExists) {
        setNotice(`Create your ${fareTicker} token account in Phantom…`);
        const setupSignature = await ensureFareTokenAccount(connection, status);
        if (setupSignature) setSignature(setupSignature);
      }
      const sizing = await quoteMintFarePurchase(missingFareRaw);
      const tradeQuote = await quoteTrade('buy', Number(sizing.inputSol) * 1.005);
      setNotice(`Approve the ${fareTicker} purchase in Phantom…`);
      const purchaseSignature = await executeTrade(connection, tradeQuote.quoteId);
      setSignature(purchaseSignature);
      setNotice(`${fareTicker} purchase submitted. Waiting for confirmation…`);
      await waitForTransaction(purchaseSignature);
      const refreshed = await prepareMintQuote(connection, status);
      setPreparedMint(refreshed);
      setQuoteError('');
      const message = refreshed.ownerFareBalance >= BigInt(refreshed.quote.amountFareRaw)
        ? `${fareTicker} is ready. You can mint your taxi now.`
        : `Your balance is still below the refreshed mint quote. Buy the remaining ${fareTicker} amount.`;
      setNotice(message);
      notifySuccess(message, { id: toastId });
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      const message = error.message || `${fareTicker} purchase failed.`;
      setNotice(message);
      notifyError(message, { id: toastId });
    } finally {
      setBuyBusy(false);
    }
  }

  async function handleActivateTrainee(event) {
    event.preventDefault();
    if (!status?.deployed) return showTraineeError('The trainee program is not available.');
    if (paused) return showTraineeError('The protocol is paused. Trainee activation is temporarily disabled.');
    if (!keyword.trim()) return showTraineeError('Enter the code word.');
    setTraineeBusy('activate');
    setTraineeNotice('Approve one activation transaction in Phantom…');
    setTraineeSignature('');
    const toastId = notifyLoading('Activating your trainee taxi…');
    try {
      const connection = wallet || await connectWallet();
      const ownedTrainees = await loadOwnedTrainees(connection.account.address, status);
      setTrainees(ownedTrainees);
      if (ownedTrainees.some(trainee => trainee.campaignId === PRIMARY_TRAINEE_CAMPAIGN_ID)) {
        setKeyword('');
        throw new Error('This wallet already has a trainee taxi for the TAXI campaign.');
      }
      const nextSignature = await activateTrainee(connection, keyword.trim(), status);
      const nextStatus = await loadProtocolStatus();
      setStatus(nextStatus);
      setTrainees(await loadOwnedTrainees(connection.account.address, nextStatus));
      setKeyword('');
      setTraineeSignature(nextSignature);
      const message = 'Your temporary trainee taxi is active and participates automatically.';
      setTraineeNotice(message);
      notifySuccess(message, { id: toastId });
    } catch (error) {
      if (error.signature) setTraineeSignature(error.signature);
      const rawMessage = error.message || 'Trainee activation failed.';
      const message = /Allocate: account .* already in use/i.test(rawMessage)
        ? 'This wallet already has a trainee taxi for the TAXI campaign.'
        : rawMessage;
      setTraineeNotice(message);
      notifyError(message, { id: toastId });
    } finally {
      setTraineeBusy('');
    }
  }

  async function handleClaimTrainee(trainee) {
    if (!wallet) return showTraineeError('Connect Phantom first.');
    if (paused) return showTraineeError('The protocol is paused. Claims are temporarily disabled.');
    setTraineeBusy(`claim-${trainee.campaignId}`);
    setTraineeNotice('Approve one claim transaction in Phantom…');
    setTraineeSignature('');
    const toastId = notifyLoading('Claiming trainee rewards…');
    try {
      const nextSignature = await claimTrainee(wallet, trainee, status);
      const nextStatus = await loadProtocolStatus();
      setStatus(nextStatus);
      setTrainees(await loadOwnedTrainees(wallet.account.address, nextStatus));
      setTraineeSignature(nextSignature);
      const message = 'Trainee rewards claimed.';
      setTraineeNotice(message);
      notifySuccess(message, { id: toastId });
    } catch (error) {
      if (error.signature) setTraineeSignature(error.signature);
      const message = error.message || 'Trainee claim failed.';
      setTraineeNotice(message);
      notifyError(message, { id: toastId });
    } finally {
      setTraineeBusy('');
    }
  }

  function showMintError(message) {
    setNotice(message);
    notifyError(message);
  }

  function showTraineeError(message) {
    setTraineeNotice(message);
    notifyError(message);
  }

  useEffect(() => {
    if (isPreviewHovered) return undefined;

    let interval;
    let cancelled = false;

    Promise.all(PREVIEW_ITEMS.map(({ scene }) => new Promise(resolve => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = appAssetPath(scene.imageUrl);
      if (image.complete) resolve();
    }))).then(() => {
      if (cancelled) return;
      interval = window.setInterval(() => {
        dispatchPreview({ type: 'advance' });
      }, 1000);
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isPreviewHovered]);

  useLayoutEffect(() => {
    previewRef.current?.querySelectorAll('.fare-mint-preview-scene:not(.is-active) .fare-fleet-headlight').forEach(light => {
      light.getAnimations().forEach(animation => animation.cancel());
    });
  }, [preview.currentIndex]);

  return (
    <>
      <main className="fare-mint-main" id="top">
        <section className="container fare-mint-section" aria-labelledby="mint-page-title">
          <div className="fare-mint-intro fare-page-heading">
            <div>
              <span>GENESIS TAXI COLLECTION</span>
              <h1 className="fare-page-title is-long" id="mint-page-title">MINT YOUR TAXI</h1>
            </div>
          </div>

          <div className="fare-mint-layout">
            <div
              className="fare-mint-preview"
              ref={previewRef}
              onMouseEnter={() => setIsPreviewHovered(true)}
              onMouseLeave={() => setIsPreviewHovered(false)}
            >
              <div className="fare-mint-preview-scenes">
                {PREVIEW_ITEMS.map(({ scene }, index) => {
                  const isActive = index === preview.currentIndex;
                  const isPrevious = index === preview.previousIndex;
                  return (
                    <div className={`fare-mint-preview-scene${isPrevious ? ' is-previous' : ''}${isActive ? ' is-active' : ''}`} key={scene.id || scene.name}>
                      <FareStepDrivingScene scene={scene} />
                    </div>
                  );
                })}
              </div>
              <span className={`fare-fleet-class is-${selectedPreview.tone}`}>{selectedPreview.label.toUpperCase()}</span>
            </div>

            <div className="fare-mint-panel">
              <h2>RANDOM TAXI MINT</h2>

              <div className="fare-mint-classes" aria-label="Taxi class">
                {MINT_CLASSES.map((item, index) => {
                  const minted = mintedByClass[index];
                  const progress = minted / item.supply * 100;
                  const classRemaining = Math.max(0, item.supply - minted);
                  const currentOdds = remaining > 0 ? `${(classRemaining / remaining * 100).toFixed(2)}%` : '0.00%';

                  return (
                    <div className="fare-mint-class-option" key={item.name}>
                      <button
                        type="button"
                        disabled
                      >
                        {item.name} · {currentOdds}
                      </button>
                      <div className="fare-mint-class-count"><span>Minted</span><strong>{minted}/{item.supply}</strong></div>
                      <div
                        className="fare-mint-progress"
                        role="progressbar"
                        aria-label={`${item.name}: ${minted} of ${item.supply} taxis minted`}
                        aria-valuemin="0"
                        aria-valuemax={item.supply}
                        aria-valuenow={minted}
                      >
                        <span style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="fare-mint-quantity-row">
                <div className="fare-mint-weight" aria-label="Total remaining supply">
                  <span>Remaining</span>
                  <strong>{remainingLoaded ? remaining : '—'}</strong>
                </div>
              </div>

              <div className="fare-mint-summary">
                <div><span>Taxi</span><strong>Random · Revealed after mint</strong></div>
                <div><span>Mint price</span><strong>{databaseMint ? formatUsdCents(priceUsdCents) : '—'}</strong></div>
                <div><span>Cars</span><strong>{quantity}</strong></div>
                <div className="is-total"><span>Total</span><strong>{databaseMint ? formatUsdCents(priceUsdCents * BigInt(quantity)) : '—'}</strong></div>
              </div>

              {preparedMint && <p className="fare-mint-note">≈ {formatTokenAmount(BigInt(preparedMint.quote.amountFareRaw), fareDecimals)} ${fareTicker} per taxi · quote expires in {Math.max(0, Number(BigInt(preparedMint.quote.expiresAt) - BigInt(Math.floor(Date.now() / 1000))))}s<br />Balance: {formatTokenAmount(preparedMint.ownerFareBalance, fareDecimals)} ${fareTicker}</p>}
              {quoteError && <p className="fare-garage-notice" role="status">{quoteError}</p>}

              {notice && <p className="fare-garage-notice" role="status">{notice}</p>}
              {signature && <a className="fare-garage-signature" href={explorerTransaction(signature)} target="_blank" rel="noreferrer">View transaction</a>}
              {preparedMint && !hasQuotedBalance ? (
                <button className="fare-mint-submit" type="button" disabled={busy || buyBusy} onClick={handleBuyMissingFare}>
                  <span>{buyBusy ? `Buying ${fareTicker}…` : `Buy ${formatTokenAmount(missingFareRaw, fareDecimals)} ${fareTicker}`}</span>
                  <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span>
                </button>
              ) : (
                <button className="fare-mint-submit" type="button" disabled={busy || buyBusy || !status?.deployed || !databaseMint?.saleStarted || paused || remaining === 0 || (wallet && !preparedMint)} onClick={handleMint}>
                  <span>{busy ? 'Minting…' : paused ? 'Mint paused' : remaining === 0 ? 'Sold out' : 'Mint taxi NFT'}</span>
                  <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span>
                </button>
              )}
            </div>
          </div>

          <section className="fare-trainee-mint" aria-labelledby="trainee-mint-title">
            <div className="fare-trainee-mint-copy">
              <span>FREE TEMPORARY TAXI</span>
              <h2 id="trainee-mint-title">START AS A TRAINEE</h2>
              <p>Enter the code word published by Fare Share. The trainee NFT is non-transferable and participates automatically for the campaign period.</p>
              <p className="fare-trainee-mint-note">The NFT appears in your wallet and Garage. It cannot be transferred or repaired. Your wallet pays only Solana account rent and the network fee.</p>
            </div>
            <div className="fare-trainee-mint-panel">
              <form onSubmit={handleActivateTrainee}>
                <label htmlFor="trainee-keyword">Code word<input id="trainee-keyword" value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Code word from the official post" /></label>
                <button type="submit" disabled={Boolean(traineeBusy) || paused || !keyword.trim()}>{traineeBusy === 'activate' ? 'Activating…' : wallet ? 'Activate trainee taxi' : 'Connect and activate'}</button>
              </form>
              {traineeNotice && <p className="fare-trainee-message" role="status">{traineeNotice}</p>}
              {traineeSignature && <a className="fare-garage-signature" href={explorerTransaction(traineeSignature)} target="_blank" rel="noreferrer">View transaction</a>}
              {trainees.length > 0 && <div className="fare-trainee-list">
                {trainees.map(trainee => <article key={String(trainee.campaignId)}>
                  <div><strong>Trainee taxi</strong><span>Active until {new Date(Number(trainee.activeUntil) * 1000).toLocaleString('en-US')}</span><small>{trainee.rewardDisplay} TAXI claimable</small></div>
                  <button type="button" disabled={Boolean(traineeBusy) || paused || trainee.reward === 0n} onClick={() => handleClaimTrainee(trainee)}>{traineeBusy === `claim-${trainee.campaignId}` ? 'Claiming…' : 'Claim TAXI'}</button>
                </article>)}
              </div>}
            </div>
          </section>
        </section>
      </main>
      {mintReveal && <MintRevealModal reveal={mintReveal} onClose={() => setMintReveal(null)} />}
    </>
  );
}

async function loadMintReveal(owner, asset) {
  const [fleetResult, marketResult] = await Promise.allSettled([
    loadDatabaseFleet(owner),
    loadPublicMarket(),
  ]);
  if (fleetResult.status !== 'fulfilled') return null;
  const taxi = fleetResult.value.find(item => item.asset === asset);
  if (!taxi) return null;
  const offers = marketResult.status === 'fulfilled' ? marketResult.value.offers || [] : [];
  const bestOffer = offers
    .filter(offer => String(offer.buyer) !== owner && offerMatchesMint(offer, taxi))
    .sort((left, right) => {
      const leftPrice = BigInt(left.priceLamports);
      const rightPrice = BigInt(right.priceLamports);
      return leftPrice === rightPrice ? 0 : leftPrice > rightPrice ? -1 : 1;
    })[0] || null;
  return { ...taxi, className: taxi.className || classNameFromWeight(taxi.weight), bestOffer };
}

function offerMatchesMint(offer, taxi) {
  if (offer.kind === 'asset') return offer.asset === taxi.asset;
  if (offer.kind === 'class') return Number(offer.weight) === Number(taxi.weight);
  return offer.kind === 'model' && offer.modelName === taxiModelName(taxi.name);
}

function taxiModelName(name) {
  return String(name || '').replace(/^TAXI\s+/i, '').replace(/\s+#\d+$/, '');
}

function classNameFromWeight(weight) {
  return ({ 1: 'Economy', 3: 'Comfort', 10: 'Business', 30: 'Legend' })[Number(weight)] || 'Taxi';
}
