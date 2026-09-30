import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import {
  activateTrainee,
  claimTrainee,
  explorerTransaction,
  formatTokenAmount,
  loadOwnedTrainees,
  loadProtocolStatus,
  mintMachine,
  prepareMintQuote,
} from './protocol/solana.js';
import { loadPublicOverview, saveMintToDatabase } from './publicData.js';
import { useTokenConfig } from './tokenConfig.jsx';

const MINT_CLASSES = [
  { name: 'Economy', tone: 'economy', weight: 1, supply: 833, odds: '68.17%', sceneNames: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'] },
  { name: 'Comfort', tone: 'comfort', weight: 3, supply: 278, odds: '22.75%', sceneNames: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'] },
  { name: 'Business', tone: 'business', weight: 10, supply: 83, odds: '6.79%', sceneNames: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'] },
  { name: 'Legend', tone: 'legend', weight: 30, supply: 28, odds: '2.29%', sceneNames: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'] },
].map(item => ({
  ...item,
  scenes: item.sceneNames.map(name => drivingScenes.find(car => car.name === name)).filter(Boolean),
}));

function formatUsdCents(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
}

function previewReducer(state, action) {
  if (action.type === 'select-class') {
    return {
      previous: state.current,
      current: { classIndex: action.classIndex, sceneIndex: 0 },
    };
  }

  return {
    previous: state.current,
    current: {
      ...state.current,
      sceneIndex: (state.current.sceneIndex + 1) % action.sceneCount,
    },
  };
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
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0);
  const [signature, setSignature] = useState('');
  const [preparedMint, setPreparedMint] = useState(null);
  const [quoteError, setQuoteError] = useState('');
  const [trainees, setTrainees] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [traineeBusy, setTraineeBusy] = useState('');
  const [traineeNotice, setTraineeNotice] = useState('');
  const [traineeSignature, setTraineeSignature] = useState('');
  const [preview, dispatchPreview] = useReducer(previewReducer, {
    current: { classIndex: 0, sceneIndex: 0 },
    previous: null,
  });
  const selectedClassIndex = preview.current.classIndex;
  const previewSceneIndex = preview.current.sceneIndex;
  const selectedClass = MINT_CLASSES[selectedClassIndex];
  const mintedByClass = databaseMint?.mintedByClass?.length === 4 ? databaseMint.mintedByClass : [0, 0, 0, 0];
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
  const jupiterBuyUrl = `https://jup.ag/swap/SOL-${encodeURIComponent(tokenConfig.mint)}`;

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
  }, [wallet, status?.deployed, status?.config?.fareMint, paused, remaining, quoteRefreshKey]);

  useEffect(() => {
    if (!wallet) return undefined;
    const refreshOnReturn = () => setQuoteRefreshKey(value => value + 1);
    window.addEventListener('focus', refreshOnReturn);
    return () => window.removeEventListener('focus', refreshOnReturn);
  }, [wallet]);

  useEffect(() => {
    if (!wallet || !status?.deployed) {
      setTrainees([]);
      setKeyword(ticker);
      return undefined;
    }
    let active = true;
    loadOwnedTrainees(wallet.account.address, status)
      .then(value => {
        if (!active) return;
        setTrainees(value);
        setKeyword(value.some(trainee => trainee.campaignId === 1n) ? '' : ticker);
      })
      .catch(error => active && setTraineeNotice(error.message));
    return () => { active = false; };
  }, [wallet, status, ticker]);

  async function handleMint() {
    if (!status?.deployed) return setNotice('The mint program is not available.');
    if (paused) return setNotice('The protocol is paused. Minting is temporarily disabled.');
    if (remaining === 0) return setNotice('The taxi collection is sold out.');
    setBusy(true);
    setSignature('');
    setNotice('Approve the transaction in Phantom…');
    let lastSignature = '';
    let mintedCount = 0;
    try {
      const connection = wallet || await connectWallet();
      const result = await mintMachine(connection, status, preparedMint);
      lastSignature = result.signature;
      mintedCount = 1;
      setSignature(lastSignature);
      await saveMintToDatabase({
        signature: result.signature,
        asset: String(result.asset),
        owner: String(connection.account.address),
      });
      setDatabaseMint((await loadPublicOverview()).mint);
      setStatus(await loadProtocolStatus());
      setPreparedMint(null);
      setSignature(lastSignature);
      setNotice('Taxi NFT minted from the precommitted random collection.');
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      setNotice(mintedCount
        ? `${mintedCount} taxi${mintedCount === 1 ? '' : 's'} minted onchain, but database synchronization needs to retry: ${error.message || 'unknown error'}`
        : error.message || 'Mint failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateTrainee(event) {
    event.preventDefault();
    if (!status?.deployed) return setTraineeNotice('The trainee program is not available.');
    if (paused) return setTraineeNotice('The protocol is paused. Trainee activation is temporarily disabled.');
    if (!keyword.trim()) return setTraineeNotice('Enter the code word.');
    setTraineeBusy('activate');
    setTraineeNotice('Approve one activation transaction in Phantom…');
    setTraineeSignature('');
    try {
      const connection = wallet || await connectWallet();
      const nextSignature = await activateTrainee(connection, keyword.trim(), status);
      const nextStatus = await loadProtocolStatus();
      setStatus(nextStatus);
      setTrainees(await loadOwnedTrainees(connection.account.address, nextStatus));
      setKeyword('');
      setTraineeSignature(nextSignature);
      setTraineeNotice('Your temporary trainee taxi is active and participates automatically.');
    } catch (error) {
      if (error.signature) setTraineeSignature(error.signature);
      setTraineeNotice(error.message || 'Trainee activation failed.');
    } finally {
      setTraineeBusy('');
    }
  }

  async function handleClaimTrainee(trainee) {
    if (!wallet) return setTraineeNotice('Connect Phantom first.');
    if (paused) return setTraineeNotice('The protocol is paused. Claims are temporarily disabled.');
    setTraineeBusy(`claim-${trainee.campaignId}`);
    setTraineeNotice('Approve one claim transaction in Phantom…');
    setTraineeSignature('');
    try {
      const nextSignature = await claimTrainee(wallet, trainee, status);
      const nextStatus = await loadProtocolStatus();
      setStatus(nextStatus);
      setTrainees(await loadOwnedTrainees(wallet.account.address, nextStatus));
      setTraineeSignature(nextSignature);
      setTraineeNotice('Trainee rewards claimed.');
    } catch (error) {
      if (error.signature) setTraineeSignature(error.signature);
      setTraineeNotice(error.message || 'Trainee claim failed.');
    } finally {
      setTraineeBusy('');
    }
  }

  useEffect(() => {
    if (isPreviewHovered) return undefined;

    let interval;
    let cancelled = false;

    Promise.all(selectedClass.scenes.map(scene => new Promise(resolve => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = scene.imageUrl;
      if (image.complete) resolve();
    }))).then(() => {
      if (cancelled) return;
      interval = window.setInterval(() => {
        dispatchPreview({ type: 'advance', sceneCount: selectedClass.scenes.length });
      }, 1000);
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isPreviewHovered, selectedClassIndex, selectedClass.scenes.length]);

  useLayoutEffect(() => {
    previewRef.current?.querySelectorAll('.fare-mint-preview-scene:not(.is-active) .fare-fleet-headlight').forEach(light => {
      light.getAnimations().forEach(animation => animation.cancel());
    });
  }, [selectedClassIndex, previewSceneIndex]);

  return (
    <>
      <main className="fare-mint-main" id="top">
        <section className="container fare-mint-section" aria-labelledby="mint-page-title">
          <div className="fare-mint-intro fare-page-heading">
            <div>
              <span>GENESIS TAXI COLLECTION</span>
              <h1 className="fare-page-title is-long" id="mint-page-title">MINT YOUR TAXI</h1>
            </div>
            <p>Preview the next precommitted taxi, mint the NFT and put the car to work immediately. After that, you only need to keep it fueled.</p>
          </div>

          <div className="fare-mint-layout">
            <div
              className="fare-mint-preview"
              ref={previewRef}
              onMouseEnter={() => setIsPreviewHovered(true)}
              onMouseLeave={() => setIsPreviewHovered(false)}
            >
              <div className="fare-mint-preview-scenes">
                {MINT_CLASSES.flatMap((item, classIndex) => item.scenes.map((scene, sceneIndex) => {
                  const isActive = classIndex === selectedClassIndex && sceneIndex === previewSceneIndex;
                  const isPrevious = classIndex === preview.previous?.classIndex && sceneIndex === preview.previous?.sceneIndex;
                  return (
                    <div className={`fare-mint-preview-scene${isPrevious ? ' is-previous' : ''}${isActive ? ' is-active' : ''}`} key={scene.id || scene.name}>
                      <FareStepDrivingScene scene={scene} />
                    </div>
                  );
                }))}
              </div>
              <span className={`fare-fleet-class is-${selectedClass.tone}`}>{selectedClass.name.toUpperCase()}</span>
            </div>

            <div className="fare-mint-panel">
              <h2>RANDOM TAXI MINT</h2>
              <p className="muted">Every mint costs $25. The next taxi comes from a precommitted shuffled supply of 1,222 cars.</p>

              <div className="fare-mint-classes" aria-label="Taxi class">
                {MINT_CLASSES.map((item, index) => {
                  const minted = mintedByClass[index];
                  const progress = minted / item.supply * 100;

                  return (
                    <div className="fare-mint-class-option" key={item.name}>
                      <button
                        type="button"
                        disabled
                      >
                        {item.name} · {item.odds}
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
                  <strong>{remaining}</strong>
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
                <a className="fare-mint-submit" href={jupiterBuyUrl} target="_blank" rel="noreferrer">
                  <span>Buy {formatTokenAmount(missingFareRaw, fareDecimals)} ${fareTicker}</span>
                  <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span>
                </a>
              ) : (
                <button className="fare-mint-submit" type="button" disabled={busy || !status?.deployed || !databaseMint?.saleStarted || paused || remaining === 0 || (wallet && !preparedMint)} onClick={handleMint}>
                  <span>{busy ? 'Minting…' : paused ? 'Mint paused' : remaining === 0 ? 'Sold out' : 'Mint taxi NFT'}</span>
                  <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span>
                </button>
              )}
              {preparedMint && !hasQuotedBalance && <p className="fare-mint-note">The purchase opens on Jupiter to avoid Phantom's temporary block for this domain. Return here after the swap; your balance refreshes automatically.</p>}
              <p className="fare-mint-note">Final token amount is quoted immediately before minting. 100% of the ${fareTicker} payment goes to the team wallet. A small amount of SOL is required for the purchase, network fees and account rent.</p>
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
    </>
  );
}
