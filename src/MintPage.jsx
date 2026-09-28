import { useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';

const mintCar = drivingScenes.find(car => car.name === 'Chevrolet Caprice') || drivingScenes[0];
const UNIT_PRICE = 240;

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14.707 15V1H.707M14.707 1L.707 15" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function MintPage() {
  const [quantity, setQuantity] = useState(2);

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
              <FareStepDrivingScene scene={mintCar} />
              <span className="fare-fleet-class is-economy">ECONOMY</span>
            </div>

            <div className="fare-mint-panel">
              <h2>CHOOSE YOUR CLASS</h2>

              <div className="fare-mint-progress-copy"><span>Minted</span><strong>835/1,222</strong></div>
              <div className="fare-mint-progress" aria-label="835 of 1222 taxis minted"><span /></div>

              <div className="fare-mint-quantity-copy"><span>Quantity</span><span>Max 3</span></div>
              <div className="fare-mint-quantity">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(value => Math.max(1, value - 1))}>−</button>
                <strong>{quantity}</strong>
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(value => Math.min(3, value + 1))}>+</button>
              </div>

              <div className="fare-mint-summary">
                <div><span>Class</span><strong>Economy</strong></div>
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
