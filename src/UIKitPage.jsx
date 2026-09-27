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

function Specimen({ name, meta, children }) {
  return (
    <article className="ui-specimen">
      <div className="ui-specimen-preview">{children}</div>
      <div className="ui-specimen-caption"><strong>{name}</strong><span>{meta}</span></div>
    </article>
  );
}

export function UIKitPage() {
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
            <Specimen name="Lead" meta="Inter · 26px / 32px · 700"><div className="ui-type-lead">Own cars. Run shifts. Earn stock tokens.</div></Specimen>
            <Specimen name="Button" meta="Inter · 20px · 800"><div className="ui-type-button">GET STARTED</div></Specimen>
            <Specimen name="Body" meta="Inter · 17px / 24px · 500"><div className="ui-type-body">Build your taxi fleet and collect park revenue.</div></Specimen>
          </div>
        </section>

        <section className="ui-kit-section container" aria-labelledby="buttons-title">
          <div className="ui-kit-section-heading">
            <span>03</span>
            <div><h2 id="buttons-title">BUTTONS</h2><p>Use these variants without local size overrides.</p></div>
          </div>
          <div className="ui-button-grid">
            <Specimen name="Primary / large" meta="74px height · 28px horizontal padding">
              <button className="fare-button fare-button-primary" type="button">Get Started <span className="fare-round-arrow fare-round-arrow-dark"><ArrowIcon /></span></button>
            </Specimen>
            <Specimen name="Secondary / large" meta="74px height · 28px horizontal padding">
              <button className="fare-button fare-button-light" type="button">How It Works</button>
            </Specimen>
            <Specimen name="Dark / large" meta="74px height · copy action">
              <button className="fare-button fare-button-dark ui-kit-ca" type="button"><span className="fare-token-symbol">$TAXI</span><span>0x7d91...af4f2</span><span className="fare-copy-icon"><span className="fare-copy-glyph" /></span></button>
            </Specimen>
            <Specimen name="Primary / medium" meta="64px height · 28px horizontal padding">
              <button className="fare-connect" type="button">Connect Wallet</button>
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
            <span>04</span>
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
