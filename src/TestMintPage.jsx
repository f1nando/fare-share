import { useCallback, useState } from 'react';
import { MintRevealModal } from './MintRevealModal.jsx';

const TEST_REVEALS = [
  { name: 'TAXI Checker Marathon #0011', className: 'Economy', weight: 1 },
  { name: 'TAXI Toyota Prius #0012', className: 'Comfort', weight: 3 },
  { name: 'TAXI Tesla Model 3 #0013', className: 'Business', weight: 10 },
  { name: 'TAXI Porsche 911 #0014', className: 'Legend', weight: 30 },
].map((reveal, index) => ({ ...reveal, asset: `test-mint-preview-${index}`, bestOffer: null }));

export function TestMintPage() {
  const [open, setOpen] = useState(true);
  const [revealIndex, setRevealIndex] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  return <main className="fare-test-mint-main">
    <section>
      <span>MINT REVEAL TEST</span>
      <h1>Test mint modal</h1>
      <p>This page uses the same reveal component shown after a successful mint.</p>
      <button type="button" onClick={() => setOpen(true)}>Open mint reveal</button>
    </section>
    {open && <MintRevealModal
      reveal={TEST_REVEALS[revealIndex]}
      onClose={close}
      onWeightClick={() => setRevealIndex(index => (index + 1) % TEST_REVEALS.length)}
    />}
  </main>;
}
