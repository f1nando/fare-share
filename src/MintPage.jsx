import { useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';

const UNIT_PRICE = 240;
const MINT_CLASSES = [
  { name: 'Economy', tone: 'economy', supply: 1000, minted: 680, sceneName: 'Chevrolet Caprice' },
  { name: 'Comfort', tone: 'comfort', supply: 300, minted: 112, sceneName: 'Toyota Camry' },
  { name: 'Business', tone: 'business', supply: 100, minted: 35, sceneName: 'Tesla Model 3' },
  { name: 'Legend', tone: 'legend', supply: 25, minted: 8, sceneName: 'Porsche 911' },
].map(item => ({
  ...item,
  scene: drivingScenes.find(car => car.name === item.sceneName) || drivingScenes[0],
}));

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14.707 15V1H.707M14.707 1L.707 15" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function MintPage() {
  const [quantity, setQuantity] = useState(2);
  const [selectedClassIndex, setSelectedClassIndex] = useState(0);
  const selectedClass = MINT_CLASSES[selectedClassIndex];

  return (
    <>
      <main className="fare-mint-main" id="top">
        <section className="container fare-mint-section" aria-labelledby="mint-page-title">
          <div className="fare-mint-intro">
            <div>
              <span>GENESIS TAXI COLLECTION</span>
              <h1 id="mint-page-title">MINT YOUR TAXI</h1>
            </div>
            <p>Choose a class, mint the NFT and put the car to work immediately. After that, you only need to keep it fueled.</p>
          </div>

          <div className="fare-mint-layout">
            <div className="fare-mint-preview">
              <FareStepDrivingScene scene={selectedClass.scene} />
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
                        onClick={() => setSelectedClassIndex(index)}
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

              <div className="fare-mint-quantity-copy"><span>Quantity</span><span>Max 3</span></div>
              <div className="fare-mint-quantity">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
                <strong>{quantity}</strong>
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(value => Math.min(3, value + 1))}>+</button>
              </div>

              <div className="fare-mint-summary">
                <div><span>Class</span><strong>{selectedClass.name}</strong></div>
                <div><span>Cars</span><strong>{quantity}</strong></div>
                <div className="is-total"><span>Total</span><strong>${quantity * UNIT_PRICE}</strong></div>
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
