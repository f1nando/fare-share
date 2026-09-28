import { useEffect, useState } from 'react';

function XIcon() {
  return (
    <svg width="24" height="22" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18.9 0H22.581L14.541 9.3189L24 22H16.5945L10.794 14.3076L4.1565 22H0.474L9.0735 12.0317L0 0H7.5945L12.837 7.02938L18.9 0ZM17.61 19.7666H19.65L6.4845 2.11655H4.2975L17.61 19.7666Z" fill="#101010" />
    </svg>
  );
}

function MobileMenuIcon() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 2H26M2 11H26M2 20H26" stroke="#111" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function MobileWalletIcon() {
  return (
    <svg className="fare-mobile-wallet-icon" width="29" height="25" viewBox="0 0 29 25" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 4.5H23V19.5H2V4.5ZM5 1.5H21" stroke="#111" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M22.5 15V24M18 19.5H27" stroke="#111" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FareHeader({ linkPrefix = '', activeItem = linkPrefix ? null : 'home', onConnectWallet, walletLabel }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigationItems = [
    { id: 'home', label: 'HOME', href: `${linkPrefix}#top` },
    { id: 'mint', label: 'MINT', href: '/mint/' },
    { id: 'garage', label: 'GARAGE', href: '/garage/' },
    { id: 'market', label: 'MARKET', href: `${linkPrefix}#market` },
    { id: 'trade', label: 'TRADE', href: '/trade/' },
    { id: 'faq', label: 'FAQ', href: '/faq/' },
    { id: 'docs', label: 'DOCS', href: '/docs/' },
  ];

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const breakpoint = window.matchMedia('(max-width: 1100px)');
    const closeOnDesktop = (event) => {
      if (!event.matches) setIsMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    breakpoint.addEventListener('change', closeOnDesktop);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      breakpoint.removeEventListener('change', closeOnDesktop);
    };
  }, [isMenuOpen]);

  return (
    <>
      <header className="fare-header container">
        <a className="fare-brand" href={`${linkPrefix}#top`} aria-label="Fare Share home">
          <img src="/brand/fare-driver.png" alt="" decoding="async" />
          <strong>FARE SHARE</strong>
          <span className="fare-brand-ticker">$TAXI</span>
        </a>

        <nav className="fare-nav" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <a className={activeItem === item.id ? 'is-active' : undefined} href={item.href} key={item.id}>{item.label}</a>
          ))}
        </nav>

        <div className="fare-header-actions">
          <a className="fare-social" href="https://x.com/taxiempire" target="_blank" rel="noreferrer" aria-label="Fare Share on X"><XIcon /></a>
          <button className="fare-connect" type="button" onClick={onConnectWallet}>
            <span>{walletLabel || 'Connect Wallet'}</span>
            <svg className="fare-wallet-icon" width="107" height="93" viewBox="0 0 107 93" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M0 78.1789C0 90.2265 6.2065 93 12.6613 93C26.3155 93 36.577 80.6058 42.7007 70.8118C41.9559 72.9786 41.5422 75.1454 41.5422 77.2255C41.5422 82.946 44.6868 87.0196 50.8933 87.0196C59.4169 87.0196 68.5197 79.219 73.2367 70.8118C72.9056 72.0252 72.7401 73.1519 72.7401 74.192C72.7401 78.1789 74.8917 80.6924 79.2777 80.6924C93.0975 80.6924 107 55.124 107 32.7623C107 15.3411 98.5592 0 77.3743 0C40.1354 0 0 47.4967 0 78.1789ZM64.5476 30.8555C64.5476 26.5219 66.8647 23.4884 70.2575 23.4884C73.5677 23.4884 75.8848 26.5219 75.8848 30.8555C75.8848 35.1892 73.5677 38.3094 70.2575 38.3094C66.8647 38.3094 64.5476 35.1892 64.5476 30.8555ZM82.2568 30.8555C82.2568 26.5219 84.5739 23.4884 87.9668 23.4884C91.2769 23.4884 93.594 26.5219 93.594 30.8555C93.594 35.1892 91.2769 38.3094 87.9668 38.3094C84.5739 38.3094 82.2568 35.1892 82.2568 30.8555Z" fill="black" />
            </svg>
            <MobileWalletIcon />
          </button>
          <button
            className="fare-mobile-menu"
            type="button"
            aria-label="Open navigation"
            aria-expanded={isMenuOpen}
            aria-controls="fare-navigation-drawer"
            onClick={() => setIsMenuOpen(true)}
          >
            <MobileMenuIcon />
          </button>
        </div>
      </header>

      <div className={`fare-menu-layer${isMenuOpen ? ' is-open' : ''}`} aria-hidden={!isMenuOpen}>
        <button className="fare-menu-backdrop" type="button" aria-label="Close navigation" onClick={() => setIsMenuOpen(false)} />
        <aside className="fare-menu-drawer" id="fare-navigation-drawer" aria-label="Mobile navigation">
          <div className="fare-menu-drawer-header">
            <strong>MENU</strong>
            <button className="fare-menu-close" type="button" aria-label="Close navigation" onClick={() => setIsMenuOpen(false)}>×</button>
          </div>
          <nav className="fare-menu-nav">
            {navigationItems.map((item) => (
              <a className={activeItem === item.id ? 'is-active' : undefined} href={item.href} key={item.id} onClick={() => setIsMenuOpen(false)}>{item.label}</a>
            ))}
          </nav>
        </aside>
      </div>
    </>
  );
}

export function FareFooter({ linkPrefix = '' }) {
  return (
    <footer className="fare-footer">
      <div className="fare-footer-watermark" aria-hidden="true"><span>FARE</span>{' '}<span>SHARE</span></div>
      <div className="fare-footer-inner container">
        <div className="fare-footer-about">
          <div className="fare-footer-brand">
            <img src="/brand/fare-driver.png" alt="" loading="lazy" decoding="async" />
            <strong>FARE SHARE</strong>
          </div>
          <p className="fare-footer-tagline">Own cars. Run shifts. Earn stock tokens.</p>
          <p className="fare-footer-copy">Build your taxi fleet, send cars on shift, and collect park fees in<br />cash and tokenized stocks.</p>
          <a className="fare-footer-social" href="https://x.com/taxiempire" target="_blank" rel="noreferrer" aria-label="Fare Share on X"><XIcon /></a>
          <p className="fare-footer-copyright">© 2026 Fare Share. All rights reserved.</p>
        </div>

        <nav className="fare-footer-column" aria-label="Footer navigation">
          <h2>NAVIGATION</h2>
          <a href={`${linkPrefix}#top`}>Home</a>
          <a href={`${linkPrefix}#taxis`}>Fleet</a>
          <a href="/garage/">Garage</a>
          <a href={`${linkPrefix}#shift`}>Shift</a>
        </nav>
        <nav className="fare-footer-column" aria-label="Resources">
          <h2>RESOURCES</h2>
          <a href={`${linkPrefix}#how-it-works`}>How it Works</a>
          <a href={`${linkPrefix}#dashboard`}>Treasury</a>
          <a href="/docs/">Docs</a>
          <a href="/faq/">FAQ</a>
        </nav>
        <nav className="fare-footer-column" aria-label="Legal">
          <h2>LEGAL</h2>
          <a href={`${linkPrefix}#terms`}>Terms</a>
          <a href={`${linkPrefix}#privacy`}>Privacy</a>
          <a href={`${linkPrefix}#disclaimer`}>Disclaimer</a>
        </nav>
      </div>
    </footer>
  );
}
