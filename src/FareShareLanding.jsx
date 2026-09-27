function GetStartedArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.7071 15V1H0.707092M14.7071 1L0.707092 15" stroke="#FFE72F" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

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
            <svg width="24" height="22" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M18.9 0H22.581L14.541 9.3189L24 22H16.5945L10.794 14.3076L4.1565 22H0.474L9.0735 12.0317L0 0H7.5945L12.837 7.02938L18.9 0ZM17.61 19.7666H19.65L6.4845 2.11655H4.2975L17.61 19.7666Z" fill="#101010" />
            </svg>
          </a>
          <button className="fare-connect" type="button">
            Connect Wallet
            <svg className="fare-wallet-icon" width="28" height="26" viewBox="0 0 28 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M24 0H2.66667C1.95942 0 1.28115 0.280951 0.781048 0.781048C0.280951 1.28115 0 1.95942 0 2.66667V18.6667C0 19.3739 0.280951 20.0522 0.781048 20.5523C1.28115 21.0524 1.95942 21.3333 2.66667 21.3333H14.7867C14.7061 20.8935 14.6659 20.4472 14.6667 20C14.6667 17.8783 15.5095 15.8434 17.0098 14.3431C18.5101 12.8429 20.5449 12 22.6667 12C24.0726 11.9961 25.4538 12.369 26.6667 13.08V2.66667C26.6667 1.95942 26.3857 1.28115 25.8856 0.781048C25.3855 0.280951 24.7072 0 24 0ZM24 9.33333H2.66667V5.33333H24M24 14.6667V18.6667H28V21.3333H24V25.3333H21.3333V21.3333H17.3333V18.6667H21.3333V14.6667H24Z" fill="black" />
            </svg>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="fare-hero" aria-labelledby="fare-hero-title">
          <div className="fare-hero-copy">
            <h1 id="fare-hero-title"><span>OWN TAXIS.</span><span>EARN STOCK</span><span>TOKENS.</span></h1>
            <p>Put your taxis to work and collect park fees in<br />stock tokens.</p>
            <div className="fare-hero-actions">
              <a className="fare-button fare-button-primary" href="#taxis">Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span></a>
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
            Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span>
          </a>
        </section>
      </main>
    </div>
  );
}
