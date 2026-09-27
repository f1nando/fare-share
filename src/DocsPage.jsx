import { FareFooter, FareHeader } from './FareShareChrome.jsx';
import { FareShareCityBackground } from './FareShareLanding.jsx';

const steps = [
  ['01', 'GET A CAR', 'Mint or buy an NFT taxi.'],
  ['02', 'IT WORKS', 'The car starts automatically.'],
  ['03', 'REFUEL', 'Keep the car active.'],
  ['04', 'MANAGE', 'Track it from Garage.'],
];

export function DocsPage() {
  return (
    <div className="fare-page fare-docs-page">
      <FareShareCityBackground />
      <FareHeader linkPrefix="/fare-share/" activeItem="docs" />

      <main className="fare-docs-main" id="top">
        <div className="container">
          <nav className="fare-docs-tabs" aria-label="Documentation sections">
            <a className="is-active" href="#overview">OVERVIEW</a>
            <a href="#how-it-works">HOW IT WORKS</a>
            <a href="#support">SUPPORT</a>
            <a href="#terms">TERMS</a>
            <a href="#privacy">PRIVACY</a>
          </nav>

          <div className="fare-docs-layout">
            <aside className="fare-docs-sidebar">
              <span>ON THIS PAGE</span>
              <nav aria-label="On this page">
                <a className="is-active" href="#one-minute"><span>01</span>FARE SHARE IN ONE MINUTE</a>
                <a href="#what-you-own"><span>02</span>WHAT YOU OWN</a>
                <a href="#what-you-control"><span>03</span>WHAT YOU CONTROL</a>
              </nav>
            </aside>

            <article className="fare-docs-article" id="overview">
              <header className="fare-docs-article-header">
                <h1>THE ONCHAIN<br />TAXI PARK</h1>
                <p>Fare Share turns every taxi into an ownable NFT that works automatically. This overview covers only the product concept, the asset you own and the actions available to an owner.</p>
              </header>

              <div className="fare-docs-steps" id="how-it-works">
                {steps.map(([number, title, text]) => <div key={number}><strong>{number} · {title}</strong><span>{text}</span></div>)}
              </div>

              <section className="fare-docs-copy-section" id="one-minute">
                <div className="fare-docs-section-title"><span>01</span><h2>FARE SHARE IN ONE MINUTE</h2></div>
                <p>A Fare Share car is a productive NFT inside one shared taxi park. There are no shifts to start and no driver to manage; after acquisition, the car works automatically while it has fuel.</p>
                <p>The owner follows the complete cycle from two screens. Dashboard summarizes earnings and the next action, while Garage shows each individual car, its class, fuel level, status and history. When fuel reaches the pause threshold, that car stops earning until it is refueled with FSI.</p>
                <p>Park revenue is settled in cycles. After a cycle closes, the collectible amount is separated from revenue that is still pending. A completed payout contains a cash portion and the supported tokenized stock selected by the owner.</p>
                <div className="fare-docs-callout">Buy a car, let it work, keep it fueled and collect only after settlement.</div>
              </section>

              <section className="fare-docs-copy-section" id="what-you-own">
                <div className="fare-docs-section-title"><span>02</span><h2>WHAT YOU OWN</h2></div>
                <p>You own the taxi NFT in your connected wallet. Its class, identity and recorded ownership history stay attached to the token and move with it when transferred.</p>
                <p>The NFT represents a specific car in the Fare Share park, not a promise of fixed income. The car record includes its permanent class and token ID, plus operational information such as lifetime earnings, current fuel and marketplace history.</p>
                <p>A wallet transfer or confirmed marketplace sale moves control of the NFT to the receiving address. Cash, FSI and stock tokens already held by the previous owner do not move with the car unless they are included in a separate transaction.</p>
              </section>

              <section className="fare-docs-copy-section" id="what-you-control">
                <div className="fare-docs-section-title"><span>03</span><h2>WHAT YOU CONTROL</h2></div>
                <p>You choose which car to own, when to refuel it, which supported stock to receive and whether to keep or sell the NFT. Detailed operating and financial mechanics live in their own tabs.</p>
                <p>You can compare car classes before minting, review a listed car before buying it, change the stock used for future payouts and decide when to collect an available balance. Every wallet action remains subject to an explicit confirmation.</p>
                <p>You do not manually choose routes, drivers, fares or shifts. Those park operations are automatic. Your practical responsibilities are to protect the wallet, monitor fuel, review transaction details and understand that revenue and asset prices can change.</p>
              </section>
            </article>
          </div>
        </div>
      </main>

      <FareFooter linkPrefix="/fare-share/" />
    </div>
  );
}
