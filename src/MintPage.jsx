import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import {
  explorerTransaction,
  formatSolAmount,
  loadProtocolStatus,
  mintMachine,
} from './protocol/solana.js';
import { loadPublicOverview, saveMintToDatabase } from './publicData.js';

const MINT_CLASSES = [
  { name: 'Economy', tone: 'economy', weight: 1, supply: 1000, sceneNames: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'] },
  { name: 'Comfort', tone: 'comfort', weight: 3, supply: 300, sceneNames: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'] },
  { name: 'Business', tone: 'business', weight: 10, supply: 100, sceneNames: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'] },
  { name: 'Legend', tone: 'legend', weight: 30, supply: 25, sceneNames: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'] },
].map(item => ({
  ...item,
  scenes: item.sceneNames.map(name => drivingScenes.find(car => car.name === name)).filter(Boolean),
}));

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
  const previewRef = useRef(null);
  const [quantity, setQuantity] = useState(1);
  const [isPreviewHovered, setIsPreviewHovered] = useState(false);
  const [status, setStatus] = useState(null);
  const [databaseMint, setDatabaseMint] = useState(null);
  const [notice, setNotice] = useState('Loading live Solana mint state…');
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState('');
  const [preview, dispatchPreview] = useReducer(previewReducer, {
    current: { classIndex: 0, sceneIndex: 0 },
    previous: null,
  });
  const selectedClassIndex = preview.current.classIndex;
  const previewSceneIndex = preview.current.sceneIndex;
  const selectedClass = MINT_CLASSES[selectedClassIndex];
  const mintedByClass = databaseMint?.mintedByClass?.length === 4 ? databaseMint.mintedByClass : [0, 0, 0, 0];
  const selectedMinted = mintedByClass[selectedClassIndex];
  const remaining = Math.max(0, selectedClass.supply - selectedMinted);
  const priceLamports = databaseMint?.pricesLamports?.[selectedClassIndex] ? BigInt(databaseMint.pricesLamports[selectedClassIndex]) : 0n;
  const paused = Boolean(databaseMint?.paused);

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
  }, []);

  useEffect(() => {
    setQuantity(value => Math.max(1, Math.min(value, Math.max(1, remaining))));
  }, [remaining, selectedClassIndex]);

  async function handleMint() {
    if (!status?.deployed) return setNotice('The mint program is not available.');
    if (paused) return setNotice('The protocol is paused. Minting is temporarily disabled.');
    if (remaining === 0) return setNotice(`${selectedClass.name} is sold out.`);
    setBusy(true);
    setSignature('');
    setNotice(`Approve ${quantity} transaction${quantity === 1 ? '' : 's'} in Phantom…`);
    let lastSignature = '';
    let mintedCount = 0;
    try {
      const connection = wallet || await connectWallet();
      let currentStatus = status;
      for (let index = 0; index < quantity; index += 1) {
        const result = await mintMachine(connection, selectedClassIndex, currentStatus);
        lastSignature = result.signature;
        mintedCount += 1;
        setSignature(lastSignature);
        await saveMintToDatabase({
          signature: result.signature,
          asset: String(result.asset),
          owner: String(connection.account.address),
        });
        setDatabaseMint((await loadPublicOverview()).mint);
        currentStatus = await loadProtocolStatus();
        setStatus(currentStatus);
      }
      setSignature(lastSignature);
      setNotice(`${quantity} ${selectedClass.name} taxi${quantity === 1 ? '' : 's'} minted. The onchain serial selects the variant automatically.`);
    } catch (error) {
      if (error.signature) setSignature(error.signature);
      setNotice(mintedCount
        ? `${mintedCount} taxi${mintedCount === 1 ? '' : 's'} minted onchain, but database synchronization needs to retry: ${error.message || 'unknown error'}`
        : error.message || 'Mint failed.');
    } finally {
      setBusy(false);
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
            <p>Choose a class, mint the NFT and put the car to work immediately. After that, you only need to keep it fueled.</p>
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
              <h2>CHOOSE YOUR CLASS</h2>

              <div className="fare-mint-classes" aria-label="Taxi class">
                {MINT_CLASSES.map((item, index) => {
                  const minted = mintedByClass[index];
                  const progress = minted / item.supply * 100;
                  const isSelected = index === selectedClassIndex;

                  return (
                    <div className="fare-mint-class-option" key={item.name}>
                      <button
                        className={isSelected ? 'is-selected' : undefined}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          dispatchPreview({ type: 'select-class', classIndex: index });
                        }}
                      >
                        {item.name}
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
                <div>
                  <div className="fare-mint-quantity-copy"><span>Quantity</span></div>
                  <div className="fare-mint-quantity">
                    <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
                    <strong>{quantity}</strong>
                    <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(value => Math.min(Math.max(1, remaining), value + 1))}>+</button>
                  </div>
                </div>
                <div className="fare-mint-weight" aria-label={`Class weight ${selectedClass.weight}`}>
                  <span>Class weight</span>
                  <strong>×{selectedClass.weight}</strong>
                </div>
              </div>

              <div className="fare-mint-summary">
                <div><span>Class</span><strong>{selectedClass.name}</strong></div>
                <div><span>Mint price</span><strong>{databaseMint ? `${formatSolAmount(priceLamports)} SOL` : '—'}</strong></div>
                <div><span>Cars</span><strong>{quantity}</strong></div>
                <div className="is-total"><span>Total</span><strong>{databaseMint ? `${formatSolAmount(priceLamports * BigInt(quantity))} SOL` : '—'}</strong></div>
              </div>

              {notice && <p className="fare-garage-notice" role="status">{notice}</p>}
              {signature && <a className="fare-garage-signature" href={explorerTransaction(signature)} target="_blank" rel="noreferrer">View transaction</a>}
              <button className="fare-mint-submit" type="button" disabled={busy || !status?.deployed || !databaseMint?.saleStarted || paused || remaining === 0} onClick={handleMint}>
                <span>{busy ? 'Minting…' : paused ? 'Mint paused' : remaining === 0 ? 'Sold out' : 'Mint taxi NFT'}</span>
                <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span>
              </button>
              <p className="fare-mint-note">The minted car appears in your garage and starts working automatically with a full tank.</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
