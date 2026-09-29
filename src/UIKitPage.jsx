import { displayTicker, useTokenConfig } from './tokenConfig.jsx';

const spacingValues = [8, 12, 16, 24, 32, 48, 64];

const colors = [
  ['Ink', '#111111'],
  ['Taxi Yellow', '#FFE72F'],
  ['Paper', '#FFFFFF'],
  ['City', '#DEDEDE'],
  ['Muted', '#AAAAAA'],
];

function ArrowIcon({ color = '#FFE72F' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

function MobileMenuIcon() {
  return <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden="true"><path d="M2 2H26M2 11H26M2 20H26" stroke="#111" strokeWidth="3" strokeLinecap="round" /></svg>;
}

function MobileWalletIcon() {
  return <svg width="29" height="25" viewBox="0 0 29 25" fill="none" aria-hidden="true"><path d="M2 4.5H23V19.5H2V4.5ZM5 1.5H21" stroke="#111" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /><path d="M22.5 15V24M18 19.5H27" stroke="#111" strokeWidth="3" strokeLinecap="round" /></svg>;
}

function ChevronIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="44" height="44" rx="22" fill="black" />
      <path d="M14 19L22 27L30 19" stroke="white" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Specimen({ name, meta, children }) {
  return (
    <article className="ui-specimen">
      <div className="ui-specimen-preview">{children}</div>
      <div className="ui-specimen-caption"><strong>{name}</strong><span>{meta}</span></div>
    </article>
  );
}

export function UIKitPage() {
  const token = useTokenConfig();
  const ticker = displayTicker(token);
  const mint = token.mint ? `${token.mint.slice(0, 6)}...${token.mint.slice(-6)}` : 'CA pending';
  return (
    <div className="fare-page ui-kit-page">
      <header className="ui-kit-header container">
        <div>
          <span className="ui-kit-eyebrow">FARE SHARE SYSTEM</span>
          <h1>UI KIT</h1>
        </div>
        <a href="/fare-share/">Back to site</a>
      </header>

      <main>
        <section className="ui-kit-section container" aria-labelledby="containers-title">
          <div className="ui-kit-section-heading">
            <span>01</span>
            <div><h2 id="containers-title">CONTAINERS</h2><p>Shared page alignment.</p></div>
          </div>
          <div className="ui-container-demo">
            <div><strong>Default</strong><span>width: 100% · max-width: 1400px · padding: 0 12px · margin: 0 auto</span></div>
            <div className="is-hero"><strong>Hero</strong><span>width: 100% · max-width: 1700px · padding: 0 12px · margin: 0 auto</span></div>
          </div>
        </section>

        <section className="ui-kit-section container" aria-labelledby="type-title">
          <div className="ui-kit-section-heading">
            <span>02</span>
            <div><h2 id="type-title">TYPOGRAPHY</h2><p>Approved display and interface text styles.</p></div>
          </div>
          <div className="ui-type-list">
            <Specimen name="Hero display" meta="Intro Friday · 136px / 0.84"><div className="ui-type-hero">OWN TAXIS.</div></Specimen>
            <Specimen name="Section display" meta="Intro Friday · 70px / 0.9"><div className="ui-type-section">SIMPLE. FAIR.</div></Specimen>
            <Specimen name="Large heading" meta="Inter · 64px / 1 · 900"><div className="ui-type-heading">FOUR CARS.</div></Specimen>
            <Specimen name="Lead" meta="Inter · 26px / 32px · 700"><div className="ui-type-lead">Own taxis. Stay active. Claim token rewards.</div></Specimen>
            <Specimen name="Button" meta="Inter · 20px · 800"><div className="ui-type-button">GET STARTED</div></Specimen>
            <Specimen name="Body" meta="Inter · 17px / 24px · 500"><div className="ui-type-body">Build your taxi fleet and collect park revenue.</div></Specimen>
          </div>
        </section>

        <section className="ui-kit-section container" aria-labelledby="component-text-title">
          <div className="ui-kit-section-heading">
            <span>03</span>
            <div><h2 id="component-text-title">COMPONENT TEXT</h2><p>Every text treatment used inside product components.</p></div>
          </div>
          <div className="ui-component-type-grid">
            <Specimen name="Step card" meta="Number 37px · title 39px · body 20px / 22px">
              <div className="fare-step-card ui-step-type-card">
                <span className="fare-step-number">1</span>
                <h3>GET A CAR</h3>
                <p>Start with a free trainee car, then build your real fleet.</p>
              </div>
            </Specimen>
            <Specimen name="Header identity" meta="Brand 28px · ticker 23px">
              <div className="fare-brand ui-brand-type"><strong>FARE SHARE</strong><span>${ticker}</span></div>
            </Specimen>
            <Specimen name="Fleet class" meta="13px · 800 · 34px height · uppercase">
              <div className="ui-badge-row">
                <span className="fare-fleet-class is-economy">ECONOMY</span>
                <span className="fare-fleet-class is-business">BUSINESS</span>
                <span className="fare-fleet-class is-legend">LEGENDARY</span>
              </div>
            </Specimen>
            <Specimen name="Treasury stat" meta="Label 20px · value 47px">
              <div className="fare-stat-card ui-stat-type"><span>VERIFIED VALUE</span><strong className="is-accent">—</strong></div>
            </Specimen>
            <Specimen name="Leaderboard row" meta="Header 18px · row 22px">
              <div className="ui-table-type"><div><span>#</span><span>DRIVER</span><span>ACTIVE WEIGHT</span></div><p><span>—</span><span>No verified data</span><strong>—</strong></p></div>
            </Specimen>
            <Specimen name="FAQ copy" meta="Question 29px · answer 20px / 28px">
              <div className="ui-faq-type"><strong>WHAT ARE THE FEES?</strong><p>Every charge is shown before you confirm an action.</p></div>
            </Specimen>
            <Specimen name="Footer copy" meta="Heading 26px · link 26px · body 21px">
              <div className="ui-footer-type"><strong>NAVIGATION</strong><a href="#footer-sample">Fleet</a><p>Build your taxi fleet and collect park fees.</p></div>
            </Specimen>
            <Specimen name="Data and mono" meta="Roboto Mono · 18–23px">
              <div className="ui-mono-type"><span>$NFT</span><strong>2NUNSx...2EGVnF</strong></div>
            </Specimen>
          </div>
        </section>

        <section className="ui-kit-section container" aria-labelledby="buttons-title">
          <div className="ui-kit-section-heading">
            <span>04</span>
            <div><h2 id="buttons-title">BUTTONS & CONTROLS</h2><p>Every interactive treatment used on the landing page.</p></div>
          </div>
          <div className="ui-button-grid">
            <Specimen name="Primary / large" meta="74px height · 28px horizontal padding">
              <button className="fare-button fare-button-primary" type="button">Get Started <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span></button>
            </Specimen>
            <Specimen name="Secondary / large" meta="74px height · 28px horizontal padding">
              <button className="fare-button fare-button-light" type="button">How It Works</button>
            </Specimen>
            <Specimen name="Dark / large" meta="74px height · copy action">
              <button className="fare-button fare-button-dark ui-kit-ca" type="button"><span className="fare-token-symbol">${ticker}</span><span>{mint}</span><span className="fare-copy-icon"><span className="fare-copy-glyph" /></span></button>
            </Specimen>
            <Specimen name="Primary / medium" meta="64px height · 28px horizontal padding">
              <button className="fare-connect" type="button">Connect Wallet</button>
            </Specimen>
            <Specimen name="Mobile header actions" meta="44 × 44px rendered · 2px border · 4px / 5px shadow">
              <div className="ui-mobile-header-actions">
                <button className="fare-mobile-menu" type="button" aria-label="Mobile menu example"><MobileMenuIcon /></button>
                <button className="fare-connect" type="button" aria-label="Mobile wallet example"><MobileWalletIcon /></button>
              </div>
            </Specimen>
            <Specimen name="Leaderboard action" meta="64px height · trailing arrow">
              <a className="fare-leaderboard-button" href="#leaderboard-sample">View Full Leaderboard <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon color="#FFFFFF" /></span></a>
            </Specimen>
            <Specimen name="FAQ control" meta="108px row · 44px icon">
              <div className="fare-faq-entry ui-faq-control"><button className="fare-faq-item" type="button"><span>CAN I SELL MY CARS?</span><ChevronIcon /></button></div>
            </Specimen>
            <Specimen name="Navigation states" meta="64px item · active pill">
              <nav className="fare-nav ui-nav-control"><a className="is-active" href="#home-sample">HOME</a><a href="#fleet-sample">FLEET</a><a href="#docs-sample">DOCS</a></nav>
            </Specimen>
            <Specimen name="Icon action" meta="64 × 64px">
              <a className="fare-social" href="https://x.com/taxiempire" target="_blank" rel="noreferrer" aria-label="Fare Share on X"><XIcon /></a>
            </Specimen>
          </div>
          <div className="ui-size-table">
            <div><strong>Large</strong><span>74px</span><span>Primary page actions</span></div>
            <div><strong>Medium</strong><span>64px</span><span>Header and local actions</span></div>
            <div><strong>Mobile</strong><span>48px</span><span>Controls below 600px</span></div>
          </div>
        </section>

        <section className="ui-kit-section container" aria-labelledby="foundations-title">
          <div className="ui-kit-section-heading">
            <span>05</span>
            <div><h2 id="foundations-title">FOUNDATIONS</h2><p>Core color and spacing values.</p></div>
          </div>
          <div className="ui-foundation-grid">
            <div className="ui-panel">
              <h3>COLORS</h3>
              <div className="ui-color-list">{colors.map(([name, value]) => <div key={value}><i style={{ background: value }} /><strong>{name}</strong><span>{value}</span></div>)}</div>
            </div>
            <div className="ui-panel">
              <h3>SPACING</h3>
              <div className="ui-spacing-list">{spacingValues.map(value => <div key={value}><span>{value}px</span><i style={{ width: `${value}px` }} /></div>)}</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
