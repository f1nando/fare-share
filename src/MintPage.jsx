import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';

const MINT_CLASSES = [
  { name: 'Economy', tone: 'economy', weight: 1, priceSol: 0.5, supply: 1000, minted: 680, sceneNames: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'] },
  { name: 'Comfort', tone: 'comfort', weight: 3, priceSol: 1.2, supply: 300, minted: 112, sceneNames: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'] },
  { name: 'Business', tone: 'business', weight: 10, priceSol: 3.3, supply: 100, minted: 35, sceneNames: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'] },
  { name: 'Legend', tone: 'legend', weight: 30, priceSol: 7.9, supply: 25, minted: 8, sceneNames: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'] },
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

export function MintPage() {
  const previewRef = useRef(null);
  const [quantity, setQuantity] = useState(2);
  const [isPreviewHovered, setIsPreviewHovered] = useState(false);
  const [preview, dispatchPreview] = useReducer(previewReducer, {
    current: { classIndex: 0, sceneIndex: 0 },
    previous: null,
  });
  const selectedClassIndex = preview.current.classIndex;
  const previewSceneIndex = preview.current.sceneIndex;
  const selectedClass = MINT_CLASSES[selectedClassIndex];

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
                  const progress = item.minted / item.supply * 100;
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
                      <div className="fare-mint-class-count"><span>Minted</span><strong>{item.minted}/{item.supply}</strong></div>
                      <div
                        className="fare-mint-progress"
                        role="progressbar"
                        aria-label={`${item.name}: ${item.minted} of ${item.supply} taxis minted`}
                        aria-valuemin="0"
                        aria-valuemax={item.supply}
                        aria-valuenow={item.minted}
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
                    <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(value => value + 1)}>+</button>
                  </div>
                </div>
                <div className="fare-mint-weight" aria-label={`Class weight ${selectedClass.weight}`}>
                  <span>Class weight</span>
                  <strong>×{selectedClass.weight}</strong>
                </div>
              </div>

              <div className="fare-mint-summary">
                <div><span>Class</span><strong>{selectedClass.name}</strong></div>
                <div><span>Mint price</span><strong>{selectedClass.priceSol.toFixed(1)} SOL</strong></div>
                <div><span>Cars</span><strong>{quantity}</strong></div>
                <div className="is-total"><span>Total</span><strong>{(quantity * selectedClass.priceSol).toFixed(1)} SOL</strong></div>
              </div>

              <button className="fare-mint-submit" type="button">
                <span>Mint taxi NFT</span>
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
