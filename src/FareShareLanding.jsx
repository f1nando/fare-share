export function FareShareLanding() {
  const steps = [
    {
      number: '1',
      title: 'GET A CAR',
      text: 'Start with a free trainee car, then build your real fleet.',
      image: '/fare-share/how-it-works/get-a-car.png',
    },
    {
      number: '2',
      title: 'RUN A SHIFT',
      text: 'Send ready cars to work with one clear action.',
      image: '/fare-share/how-it-works/run-a-shift.png',
    },
    {
      number: '3',
      title: 'COLLECT',
      text: 'Receive daily revenue in cash and your selected stock.',
      image: '/fare-share/how-it-works/collect.png',
    },
  ];

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
            <h1 id="fare-hero-title"><span>OWN TAXIS.</span><span>EARN STOCK</span><span>TOKENS.</span></h1>
            <p>Put your taxis to work and collect park fees in<br />stock tokens.</p>
            <div className="fare-hero-actions">
              <a className="fare-button fare-button-primary" href="#taxis">Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true">↗</span></a>
              <a className="fare-button fare-button-light" href="#how-it-works">How It Works</a>
              <a className="fare-button fare-button-dark" href="#token">
                <span className="fare-token-symbol">$TAXI</span>
                <span>0x7d91...af4f2</span>
                <span className="fare-copy-icon" aria-hidden="true" />
                <span className="fare-round-arrow fare-round-arrow-light" aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </section>

        <section className="fare-how" id="how-it-works" aria-labelledby="fare-how-title">
          <div className="fare-how-heading">
            <h2 id="fare-how-title">SIMPLE. FAIR. CLEAR.</h2>
            <p>Get a car, run one shift, collect revenue, service it<br />when needed.</p>
          </div>

          <div className="fare-step-grid">
            {steps.map(step => <article className="fare-step-card" key={step.number}>
              <span className="fare-step-number" aria-hidden="true">{step.number}</span>
              <img src={step.image} alt="" />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>)}
          </div>

          <a className="fare-button fare-button-primary fare-how-button" href="#taxis">
            Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true">↗</span>
          </a>
        </section>
      </main>
    </div>
  );
}
