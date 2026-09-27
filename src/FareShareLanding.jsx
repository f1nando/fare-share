function GetStartedArrow({ color = '#FFE72F' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.7071 15V1H0.707092M14.7071 1L0.707092 15" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="24" height="22" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18.9 0H22.581L14.541 9.3189L24 22H16.5945L10.794 14.3076L4.1565 22H0.474L9.0735 12.0317L0 0H7.5945L12.837 7.02938L18.9 0ZM17.61 19.7666H19.65L6.4845 2.11655H4.2975L17.61 19.7666Z" fill="#101010" />
    </svg>
  );
}

function FaqChevron() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="44" height="44" rx="22" fill="black" />
      <path d="M14 19L22 27L30 19" stroke="white" strokeWidth="2" strokeLinejoin="round" />
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

  const treasuryStats = [
    { label: 'TRADING / 24H', value: '$482,918', accent: true },
    { label: 'FEES COLLECTED', value: '$18,482' },
    { label: 'IN TREASURY', value: '$84,218' },
    { label: 'PAID TODAY', value: '$12,204' },
    { label: 'TOKENS BURNED', value: '1.82M' },
    { label: 'STOCKS PURCHASED', value: '$9,241' },
  ];

  const leaders = [
    ['1', '24 430$'],
    ['2', '16 842$'],
    ['3', '24 430$'],
    ['4', '16 842$'],
    ['5', '24 430$'],
  ];

  const faqItems = [
    'HOW DO IT EARN FROM MY CARS?',
    'WHAT ARE THE FEES?',
    'CAN I SELL MY CARS?',
    'IS THIS A REAL PRODUCT?',
    'WHERE CAN I READ THE FULL DOCS',
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
            <XIcon />
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

        <section className="fare-fleet" id="taxis" aria-labelledby="fare-fleet-title">
          <div className="fare-fleet-heading">
            <h2 id="fare-fleet-title">FOUR CARS. ONE RULE.</h2>
            <p>Better classes receive a larger earning share. No twelve-stat<br />RPG spreadsheet.</p>
          </div>

          <a className="fare-button fare-button-primary fare-fleet-button" href="#garage">
            Explore The Fleet <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span>
          </a>
        </section>

        <section className="fare-treasury" id="dashboard" aria-labelledby="fare-treasury-title">
          <div className="fare-treasury-heading">
            <h2 id="fare-treasury-title">PARK TREASURY.</h2>
            <p>The trust page: trading, collected fees, treasury, payouts, token<br />burns and stock inventory.</p>
          </div>

          <p className="fare-treasury-intro">Own taxi cars, send them on shift, and collect park revenue in cash and stocks.</p>

          <div className="fare-stat-grid">
            {treasuryStats.map(stat => <article className="fare-stat-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong className={stat.accent ? 'is-accent' : undefined}>{stat.value}</strong>
              <i className="fare-chevron" aria-hidden="true" />
            </article>)}
          </div>

          <div className="fare-leaderboard-heading">
            <h3>LEADERBOARD</h3>
            <a className="fare-leaderboard-button" href="#leaderboard">
              View Full Leaderboard
              <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow color="#FFFFFF" /></span>
            </a>
          </div>

          <div className="fare-leaderboard" id="leaderboard">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>TOTAL EARNINGS</span>
            </div>
            {leaders.map(([position, earnings]) => <div className="fare-leaderboard-row" key={position}>
              <span>{position}</span>
              <span className="fare-driver-cell"><img src="/brand/fare-driver.png" alt="" />User_4312234</span>
              <span>12 Cars</span>
              <span>{earnings}</span>
            </div>)}
          </div>
        </section>

        <section className="fare-faq" id="faq" aria-labelledby="fare-faq-title">
          <h2 id="fare-faq-title">FAQ</h2>
          <div className="fare-faq-list">
            {faqItems.map(item => <button className="fare-faq-item" type="button" aria-expanded="false" key={item}>
              <span>{item}</span>
              <FaqChevron />
            </button>)}
          </div>
        </section>
      </main>

      <footer className="fare-footer">
        <div className="fare-footer-watermark" aria-hidden="true">FARE SHARE</div>
        <div className="fare-footer-inner">
          <div className="fare-footer-about">
            <div className="fare-footer-brand">
              <img src="/brand/fare-driver.png" alt="" />
              <strong>FARE SHARE</strong>
              <span>$NFT</span>
            </div>
            <p className="fare-footer-tagline">Own cars. Run shifts. Earn stock tokens.</p>
            <p className="fare-footer-copy">Build your taxi fleet, send cars on shift, and collect park fees in<br />cash and tokenized stocks.</p>
            <a className="fare-footer-social" href="https://x.com" target="_blank" rel="noreferrer" aria-label="Fare Share on X"><XIcon /></a>
            <p className="fare-footer-copyright">© 2026 Fare Share. All rights reserved.</p>
          </div>

          <nav className="fare-footer-column" aria-label="Footer navigation">
            <h2>NAVIGATION</h2>
            <a href="#top">Home</a>
            <a href="#taxis">Fleet</a>
            <a href="#garage">Garage</a>
            <a href="#shift">Shift</a>
          </nav>

          <nav className="fare-footer-column" aria-label="Resources">
            <h2>RESOURCES</h2>
            <a href="#how-it-works">How it Works</a>
            <a href="#dashboard">Treasury</a>
            <a href="#docs">Docs</a>
            <a href="#faq">FAQ</a>
          </nav>

          <nav className="fare-footer-column" aria-label="Legal">
            <h2>LEGAL</h2>
            <a href="#terms">Terms</a>
            <a href="#privacy">Privacy</a>
            <a href="#disclaimer">Disclaimer</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
