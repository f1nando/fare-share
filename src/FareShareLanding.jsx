export function FareShareLanding() {
  return (
    <div className="fare-page">
      <header className="fare-header">
        <a className="fare-brand" href="#top" aria-label="Fare Share home">
          <img src="/brand/fare-driver.png" alt="" />
          <strong>FARE SHARE</strong>
          <span>$TAXI</span>
        </a>

        <nav className="fare-nav" aria-label="Main navigation">
          <a className="is-active" href="#top">HOME</a>
          <a href="#dashboard">DASHBOARD</a>
          <a href="#taxis">MINT</a>
          <a href="#garage">GARAGE</a>
          <a href="#market">MARKET</a>
          <a href="#trade">TRADE</a>
          <a href="#faq">FAQ</a>
          <a href="#docs">DOCS</a>
        </nav>

        <div className="fare-header-actions">
          <a className="fare-social" href="https://x.com" target="_blank" rel="noreferrer" aria-label="Fare Share on X">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" /></svg>
          </a>
          <button className="fare-connect" type="button">Connect Wallet <span className="fare-wallet-icon" aria-hidden="true" /></button>
        </div>
      </header>

      <main id="top">
        <section className="fare-hero" aria-labelledby="fare-hero-title">
          <div className="fare-hero-copy">
            <h1 id="fare-hero-title"><span>OWN TAXIS.</span><span>EARN STOCK</span><span>RETURNS.</span></h1>
            <p>Buy NFT taxis and earn a share of real fleet revenue in FARE and tokenized stocks.</p>
            <div className="fare-hero-actions">
              <a className="fare-button fare-button-primary" href="#taxis">BUY TAXI <span aria-hidden="true">✦</span></a>
              <a className="fare-button fare-button-light" href="#how-it-works">LEARN MORE</a>
              <a className="fare-button fare-button-dark" href="#game">PLAY TAXI GAME <span aria-hidden="true">↗</span></a>
            </div>
          </div>
        </section>

        <section className="fare-placeholder" id="taxis">
          <p>FRONTEND WORKSPACE</p>
          <h2>The next section will live here.</h2>
        </section>
      </main>
    </div>
  );
}
