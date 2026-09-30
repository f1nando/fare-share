import { useEffect, useMemo, useState } from 'react';
import { DocsPage } from './DocsPage.jsx';
import { FareFooter, FareHeader } from './FareShareChrome.jsx';
import { FareShareCityBackground, FareShareLanding } from './FareShareLanding.jsx';
import { FaqPage } from './FaqPage.jsx';
import { GaragePage } from './GaragePage.jsx';
import { LeaderboardPage } from './LeaderboardPage.jsx';
import { DisclaimerPage, PrivacyPage, TermsPage } from './LegalPage.jsx';
import { MarketPage } from './MarketPage.jsx';
import { MintPage } from './MintPage.jsx';
import { TradePage } from './TradePage.jsx';
import { connectTradeWallet } from './tradeApi.js';
import { disconnectWallet, shortAddress } from './protocol/solana.js';
import { TokenConfigProvider } from './tokenConfig.jsx';
import './trade.css';

const routes = {
  '/fare-share/': {
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
    component: MarketPage,
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

function normalizePathname(pathname) {
  if (pathname === '/') return '/fare-share/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function readLocation() {
  return `${normalizePathname(window.location.pathname)}${window.location.hash}`;
}

export function FareShareApp() {
  const [location, setLocation] = useState(readLocation);
  const [wallet, setWallet] = useState(null);
  const pathname = location.split('#')[0];
  const route = routes[pathname] || routes['/fare-share/'];
  const Page = route.component;
  const isLanding = pathname === '/fare-share/';

  useEffect(() => {
    const handleNavigation = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

      const url = new URL(link.href, window.location.href);
      const nextPathname = normalizePathname(url.pathname);
      if (url.origin !== window.location.origin || !routes[nextPathname]) return;

      event.preventDefault();
      const nextLocation = `${nextPathname}${url.hash}`;
      if (nextLocation !== location) window.history.pushState({}, '', nextLocation);
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
      <FareHeader linkPrefix="/fare-share/" activeItem={route.activeItem} onConnectWallet={() => handleWalletButton().catch(error => window.alert(error.message))} walletLabel={wallet ? shortAddress(wallet.account.address) : undefined} />
      <Page wallet={wallet} connectWallet={handleConnectWallet} />
      <FareFooter linkPrefix="/fare-share/" />
    </div></TokenConfigProvider>
  );
}
