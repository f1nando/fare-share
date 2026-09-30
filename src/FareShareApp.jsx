import { useEffect, useMemo, useState } from 'react';
import { DocsPage } from './DocsPage.jsx';
import { FareFooter, FareHeader, MAGIC_EDEN_URL } from './FareShareChrome.jsx';
import { FareShareCityBackground, FareShareLanding } from './FareShareLanding.jsx';
import { FaqPage } from './FaqPage.jsx';
import { GaragePage } from './GaragePage.jsx';
import { LeaderboardPage } from './LeaderboardPage.jsx';
import { DisclaimerPage, PrivacyPage, TermsPage } from './LegalPage.jsx';
import { MintPage } from './MintPage.jsx';
import { TradePage } from './TradePage.jsx';
import { connectTradeWallet } from './tradeApi.js';
import { disconnectWallet, shortAddress } from './protocol/solana.js';
import { TokenConfigProvider } from './tokenConfig.jsx';
import { appPath, isRehearsalPath, stripAppPrefix } from './appPath.js';
import { PUBLIC_HOLDING } from './buildMode.js';
import './trade.css';

const routes = {
  '/': {
    className: 'fare-landing-page',
    component: FareShareLanding,
    activeItem: 'home',
    title: 'Fare Share',
  },
  '/mint/': {
    className: 'fare-mint-page',
    component: MintPage,
    activeItem: 'mint',
    title: 'Mint — Fare Share',
  },
  '/garage/': {
    className: 'fare-garage-page',
    component: GaragePage,
    activeItem: 'garage',
    title: 'Garage — Fare Share',
  },
  '/market/': {
    className: 'fare-market-page',
    component: MarketRedirect,
    activeItem: 'market',
    title: 'Market — Fare Share',
  },
  '/leaderboard/': {
    className: 'fare-leaderboard-page',
    component: LeaderboardPage,
    activeItem: 'leaderboard',
    title: 'Leaderboard — Fare Share',
  },
  '/trade/': {
    className: 'trade-page',
    component: TradePage,
    activeItem: 'trade',
    title: 'Trade — Fare Share',
  },
  '/docs/': {
    className: 'fare-docs-page',
    component: DocsPage,
    activeItem: 'docs',
    title: 'Documentation — Fare Share',
  },
  '/faq/': {
    className: 'fare-faq-page',
    component: FaqPage,
    activeItem: 'faq',
    title: 'FAQ — Fare Share',
  },
  '/terms/': {
    className: 'fare-docs-page fare-legal-page',
    component: TermsPage,
    title: 'Terms of Use — Fare Share',
  },
  '/privacy/': {
    className: 'fare-docs-page fare-legal-page',
    component: PrivacyPage,
    title: 'Privacy Notice — Fare Share',
  },
  '/disclaimer/': {
    className: 'fare-docs-page fare-legal-page',
    component: DisclaimerPage,
    title: 'Risk Disclaimer — Fare Share',
  },
};

function MarketRedirect() {
  useEffect(() => {
    window.location.replace(MAGIC_EDEN_URL);
  }, []);

  return <main id="top"><p><a href={MAGIC_EDEN_URL}>Open Magic Eden</a></p></main>;
}

function normalizePathname(pathname) {
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return normalized === '/fare-share/' ? '/' : normalized;
}

function readLocation() {
  return `${normalizePathname(stripAppPrefix(window.location.pathname))}${window.location.hash}`;
}

export function FareShareApp() {
  const [location, setLocation] = useState(readLocation);
  const [wallet, setWallet] = useState(null);
  const pathname = location.split('#')[0];
  const route = PUBLIC_HOLDING ? routes['/'] : routes[pathname] || routes['/'];
  const Page = route.component;
  const isLanding = pathname === '/';

  useEffect(() => {
    const canonicalPathname = isRehearsalPath() ? appPath(pathname) : pathname;
    if (window.location.pathname !== canonicalPathname) {
      window.history.replaceState({}, '', `${canonicalPathname}${window.location.hash}`);
    }
  }, [pathname]);

  useEffect(() => {
    const handleNavigation = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const url = new URL(link.href, window.location.href);
      const nextPathname = normalizePathname(stripAppPrefix(url.pathname));
      if (url.origin !== window.location.origin || !routes[nextPathname]) return;

      event.preventDefault();
      const nextLocation = `${nextPathname}${url.hash}`;
      const browserLocation = `${isRehearsalPath() ? appPath(nextPathname) : nextPathname}${url.hash}`;
      if (nextLocation !== location) window.history.pushState({}, '', browserLocation);
      setLocation(nextLocation);
    };
    const handlePopState = () => setLocation(readLocation());

    document.addEventListener('click', handleNavigation);
    window.addEventListener('popstate', handlePopState);
    return () => {
      document.removeEventListener('click', handleNavigation);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [location]);

  useEffect(() => {
    document.title = route.title;
    const hash = window.location.hash.slice(1);
    const frame = window.requestAnimationFrame(() => {
      if (hash) document.getElementById(hash)?.scrollIntoView();
      else window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location, route.title]);

  const shellClassName = useMemo(() => `fare-page ${route.className}`, [route.className]);

  async function handleConnectWallet() {
    if (wallet) return wallet;
    const connected = await connectTradeWallet();
    setWallet(connected);
    return connected;
  }

  async function handleWalletButton() {
    if (!wallet) return handleConnectWallet();
    await disconnectWallet(wallet);
    setWallet(null);
    return null;
  }

  return (
    <TokenConfigProvider><div className={shellClassName}>
      <FareShareCityBackground colorScheme={isLanding ? 'classic' : 'pale'} followHero={isLanding} />
      <FareHeader linkPrefix={appPath('/')} activeItem={route.activeItem} landingOnly={PUBLIC_HOLDING} onConnectWallet={() => handleWalletButton().catch(error => window.alert(error.message))} walletLabel={wallet ? shortAddress(wallet.account.address) : undefined} />
      <Page wallet={wallet} connectWallet={handleConnectWallet} publicHolding={PUBLIC_HOLDING} />
      <FareFooter linkPrefix={appPath('/')} landingOnly={PUBLIC_HOLDING} />
    </div></TokenConfigProvider>
  );
}
