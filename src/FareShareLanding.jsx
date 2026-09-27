export function FareShareLanding() {
  return (
    <div className="fare-page">
      <header className="fare-header">
        <a className="fare-brand" href="#top" aria-label="Fare Share home">
          <span className="fare-brand-mark" aria-hidden="true"><b>F</b></span>
          <span>FARE SHARE</span>
        </a>

        <nav className="fare-nav" aria-label="Main navigation">
          <a href="#garage">MY GARAGE</a>
          <a href="#taxis">TAXIS</a>
          <a href="#how-it-works">HOW IT WORKS</a>
          <a href="#faq">FAQ</a>
        </nav>

        <div className="fare-header-actions">
          <a className="fare-social" href="https://x.com" target="_blank" rel="noreferrer" aria-label="Fare Share on X">𝕏</a>
          <button className="fare-connect" type="button">CONNECT WALLET <span aria-hidden="true">▣</span></button>
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
