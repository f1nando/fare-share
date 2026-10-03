import { useCallback, useState } from 'react';
import { appAssetPath } from './appPath.js';
import { MintRevealModal } from './MintRevealModal.jsx';

const TEST_REVEAL = {
  asset: 'test-mint-preview',
  name: 'TAXI Checker Marathon #0011',
  image: appAssetPath('/fare-share/fleet/checker-marathon.webp'),
  className: 'Economy',
  weight: 1,
  bestOffer: null,
};

export function TestMintPage() {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  return <main className="fare-test-mint-main">
    <section>
      <span>MINT REVEAL TEST</span>
      <h1>Test mint modal</h1>
      <p>This page uses the same reveal component shown after a successful mint.</p>
      <button type="button" onClick={() => setOpen(true)}>Open mint reveal</button>
    </section>
    {open && <MintRevealModal reveal={TEST_REVEAL} onClose={close} />}
  </main>;
}
