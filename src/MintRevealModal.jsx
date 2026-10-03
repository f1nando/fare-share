import { useEffect } from 'react';
import { appPath } from './appPath.js';

export function MintRevealModal({ reveal, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = event => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  return <div className="fare-mint-reveal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="fare-mint-reveal" role="dialog" aria-modal="true" aria-labelledby="mint-reveal-title">
      <button className="fare-mint-reveal-close" type="button" aria-label="Close taxi reveal" onClick={onClose}>×</button>
      <div className="fare-mint-reveal-visual">
        {reveal.image
          ? <img src={reveal.image} alt={reveal.name} />
          : <div className="fare-mint-reveal-image-fallback">TAXI</div>}
        <span className={`fare-fleet-class is-${classTone(reveal.className)}`}>{String(reveal.className || 'Taxi').toUpperCase()}</span>
      </div>
      <div className="fare-mint-reveal-copy">
        <span className="fare-mint-reveal-kicker">YOUR TAXI IS READY</span>
        <h2 id="mint-reveal-title">CONGRATULATIONS!</h2>
        <p>You got <strong>{reveal.name}</strong>. This taxi is already in your fleet.</p>
        <div className="fare-mint-reveal-stats">
          <div><span>WEIGHT</span><strong>{reveal.weight}</strong></div>
          <div><span>CLASS</span><strong>{reveal.className || 'Taxi'}</strong></div>
          {reveal.bestOffer && <div className="is-market"><span>BEST BUY OFFER</span><strong>{formatSolOffer(reveal.bestOffer.priceLamports)} SOL</strong></div>}
        </div>
        {reveal.bestOffer && <p className="fare-mint-reveal-offer">There is already an active market request matching this taxi.</p>}
        <div className="fare-mint-reveal-actions">
          <a href={appPath('/garage/')}>View in Garage</a>
          {reveal.bestOffer && <a className="is-secondary" href={appPath('/market/sell/')}>View offer</a>}
          <button type="button" onClick={onClose}>Continue</button>
        </div>
      </div>
    </section>
  </div>;
}

function classTone(className) {
  return String(className || 'Economy').toLowerCase().replace('legendary', 'legend');
}

function formatSolOffer(rawLamports) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 }).format(Number(BigInt(rawLamports)) / 1_000_000_000);
}
