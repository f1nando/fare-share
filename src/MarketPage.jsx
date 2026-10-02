import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import { loadDatabaseFleet, loadPublicMarket, saveMarketTransaction } from './publicData.js';
import {
  acceptMarketOffer,
  buyListedMachine,
  cancelMachineSale,
  cancelMarketOffer,
  listMachineForSale,
  loadProtocolStatus,
  makeClassOffer,
  makeMachineOffer,
  makeModelOffer,
} from './protocol/solana.js';
import drivingScenes from './drivingScenes.json';
import { appAssetPath } from './appPath.js';
import './market.css';

const CLASS_BY_NAME = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map(name => [name, { name: 'Economy', tone: 'economy' }]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map(name => [name, { name: 'Comfort', tone: 'comfort' }]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map(name => [name, { name: 'Business', tone: 'business' }]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map(name => [name, { name: 'Legend', tone: 'legend' }]),
]);
const CLASS_OPTIONS = [
  { name: 'Economy', tone: 'economy', weight: 1 },
  { name: 'Comfort', tone: 'comfort', weight: 3 },
  { name: 'Business', tone: 'business', weight: 10 },
  { name: 'Legend', tone: 'legend', weight: 30 },
];
const CLASS_SCENE_NAMES = {
  Economy: ['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'],
  Comfort: ['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'],
  Business: ['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'],
  Legend: ['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'],
};
const CLASS_SCENES = new Map(Object.entries(CLASS_SCENE_NAMES).map(([className, names]) => [
  className,
  names.map(name => drivingScenes.find(scene => scene.name === name)).filter(Boolean),
]));
const MODEL_OPTIONS = Object.entries(CLASS_SCENE_NAMES).flatMap(([className, names], classIndex) => (
  names.map((name, variantIndex) => ({ className, classIndex, variantIndex, name, value: `${classIndex}:${variantIndex}` }))
));
const LISTINGS_PER_PAGE = 15;

const SORTERS = {
  featured: (left, right) => left.listedAt - right.listedAt,
  newest: (left, right) => right.nftNumber - left.nftNumber,
  'price-low': (left, right) => left.price - right.price,
  'price-high': (left, right) => right.price - left.price,
  name: (left, right) => left.name.localeCompare(right.name),
};

function shortWallet(address) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function taxiModelName(name = '') {
  return name.replace(/^TAXI\s+/, '').replace(/\s+#\d+$/, '');
}

function marketModeFromLocation() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return ['buy', 'sell', 'mine'].includes(mode) ? mode : 'buy';
}

function marketPageFromLocation() {
  const page = Number.parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function paginationItems(pageCount, currentPage) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = [1];
  if (currentPage > 4) pages.push('start-gap');
  for (let page = Math.max(2, currentPage - 1); page <= Math.min(pageCount - 1, currentPage + 1); page += 1) pages.push(page);
  if (currentPage < pageCount - 3) pages.push('end-gap');
  pages.push(pageCount);
  return pages;
}

function offerMatchesCar(offer, car) {
  if (offer.kind === 'asset') return car.asset === offer.asset;
  if (offer.kind === 'model') return taxiModelName(car.name) === offer.modelName;
  return Number(car.weight) === Number(offer.weight);
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function ClassOfferDrivingScene({ className, modelName }) {
  const scenes = useMemo(() => {
    const classScenes = CLASS_SCENES.get(className) || CLASS_SCENES.get('Economy');
    return modelName ? classScenes.filter(scene => scene.name === modelName) : classScenes;
  }, [className, modelName]);
  const [preview, setPreview] = useState({ currentIndex: 0, previousIndex: null });

  useEffect(() => {
    setPreview({ currentIndex: 0, previousIndex: null });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || scenes.length < 2) return undefined;
    let cancelled = false;
    let timer;
    Promise.all(scenes.map(scene => new Promise(resolve => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = appAssetPath(scene.imageUrl);
      if (image.complete) resolve();
    }))).then(() => {
      if (cancelled) return;
      timer = window.setInterval(() => setPreview(({ currentIndex }) => ({
        previousIndex: currentIndex,
        currentIndex: (currentIndex + 1) % scenes.length,
      })), 2800);
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [className, scenes]);

  const scene = scenes[preview.currentIndex] || scenes[0];
  return (
    <div className="fare-market-media fare-market-offer-media">
      <div className="fare-market-offer-scenes">
        {scenes.map((item, index) => (
          <div
            className={`fare-market-offer-scene${index === preview.previousIndex ? ' is-previous' : ''}${index === preview.currentIndex ? ' is-active' : ''}`}
            key={item.id || item.name}
          >
            <FareStepDrivingScene scene={item} imageLoading="eager" />
          </div>
        ))}
      </div>
      <span className="fare-market-offer-model">{scene.name}</span>
      <span className={`fare-fleet-class fare-market-offer-class is-${String(className || 'economy').toLowerCase()}`}>{className}</span>
    </div>
  );
}

export function MarketPage({ wallet, connectWallet }) {
  const [mode, setMode] = useState(marketModeFromLocation);
  const [listingPage, setListingPage] = useState(marketPageFromLocation);
  const [query, setQuery] = useState('');
  const [vehicleClass, setVehicleClass] = useState('all');
  const [sort, setSort] = useState('featured');
  const [notice, setNotice] = useState('');
  const [market, setMarket] = useState({ listings: [], offers: [], floorLamports: null, totalVolumeLamports: '0' });
  const [protocolStatus, setProtocolStatus] = useState(null);
  const [showListing, setShowListing] = useState(false);
  const [ownedCars, setOwnedCars] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [price, setPrice] = useState('');
  const [showOffer, setShowOffer] = useState(false);
  const [offerType, setOfferType] = useState('asset');
  const [offerAsset, setOfferAsset] = useState('');
  const [offerWeight, setOfferWeight] = useState('1');
  const [offerModel, setOfferModel] = useState('0:0');
  const [offerPrice, setOfferPrice] = useState('');
  const [acceptingOffer, setAcceptingOffer] = useState(null);
  const [eligibleCars, setEligibleCars] = useState([]);
  const [acceptAsset, setAcceptAsset] = useState('');
  const [openingOfferId, setOpeningOfferId] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const [busy, setBusy] = useState(false);
  const walletAddress = wallet?.account.address ? String(wallet.account.address) : '';

  useEffect(() => {
    if (!acceptingOffer && !showListing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || busy) return;
      if (acceptingOffer) setAcceptingOffer(null);
      else setShowListing(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [acceptingOffer, busy, showListing]);

  useEffect(() => {
    let active = true;
    Promise.all([loadPublicMarket(), loadProtocolStatus()])
      .then(([value, status]) => { if (active) { setMarket(value); setProtocolStatus(status); } })
      .catch(error => active && setNotice(error.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode !== 'sell' || !walletAddress) return undefined;
    let active = true;
    setFleetLoading(true);
    loadDatabaseFleet(walletAddress)
      .then(cars => { if (active) setOwnedCars(cars); })
      .catch(error => { if (active) setNotice(error.message); })
      .finally(() => { if (active) setFleetLoading(false); });
    return () => { active = false; };
  }, [mode, walletAddress]);

  const listings = market.listings.map(listing => {
    const modelName = taxiModelName(listing.name);
    const scene = drivingScenes.find(item => item.name === modelName);
    return {
      ...scene,
      ...listing,
      imageUrl: listing.imageUrl || scene?.imageUrl,
      price: Number(listing.priceLamports) / 1_000_000_000,
      vehicleClass: CLASS_BY_NAME.get(modelName) || { name: listing.className || 'Economy', tone: String(listing.className || 'economy').toLowerCase() },
    };
  });

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...listings]
      .filter(listing => vehicleClass === 'all' || listing.vehicleClass.tone === vehicleClass)
      .filter(listing => !normalizedQuery || `${listing.name} ${listing.vehicleClass.name} ${listing.nftNumber}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(SORTERS[sort]);
  }, [listings, query, sort, vehicleClass]);
  const hasActiveFilters = Boolean(query.trim()) || vehicleClass !== 'all';
  const listingPageCount = Math.max(1, Math.ceil(visibleListings.length / LISTINGS_PER_PAGE));
  const paginatedListings = visibleListings.slice((listingPage - 1) * LISTINGS_PER_PAGE, listingPage * LISTINGS_PER_PAGE);
  const listingPaginationItems = paginationItems(listingPageCount, listingPage);
  const offers = market.offers || [];
  const myListings = walletAddress ? listings.filter(listing => String(listing.seller) === walletAddress) : [];
  const myOffers = walletAddress ? offers.filter(offer => String(offer.buyer) === walletAddress) : [];
  const sellerCars = ownedCars.map(car => {
    const modelName = taxiModelName(car.name);
    const scene = drivingScenes.find(item => item.name === modelName);
    const matches = offers
      .filter(offer => String(offer.buyer) !== walletAddress && offerMatchesCar(offer, car))
      .sort((left, right) => {
        const leftPrice = BigInt(left.priceLamports);
        const rightPrice = BigInt(right.priceLamports);
        return leftPrice === rightPrice ? 0 : leftPrice > rightPrice ? -1 : 1;
    });
    return {
      ...scene,
      ...car,
      imageUrl: car.image || scene?.imageUrl,
      vehicleClass: CLASS_BY_NAME.get(modelName) || { name: 'Taxi', tone: 'economy' },
      matches,
      listing: listings.find(listing => listing.asset === car.asset),
    };
  });
  const matchingOfferCount = new Set(sellerCars.flatMap(car => car.matches.map(offer => offer.id))).size;

  useEffect(() => {
    if (listingPage <= listingPageCount) return;
    setListingPage(listingPageCount);
    const url = new URL(window.location.href);
    if (listingPageCount === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(listingPageCount));
    window.history.replaceState({}, '', url);
  }, [listingPage, listingPageCount]);

  function selectListingPage(nextPage, scroll = true) {
    const page = Math.min(listingPageCount, Math.max(1, nextPage));
    setListingPage(page);
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(page));
    window.history.replaceState({}, '', url);
    if (scroll) document.querySelector('.fare-market-console')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectMode(nextMode) {
    setMode(nextMode);
    setNotice('');
    setShowListing(false);
    setShowOffer(false);
    const url = new URL(window.location.href);
    url.searchParams.set('mode', nextMode);
    if (nextMode !== 'buy') {
      setListingPage(1);
      url.searchParams.delete('page');
    }
    window.history.replaceState({}, '', url);
  }

  async function refreshMarket() {
    setMarket(await loadPublicMarket());
  }

  async function indexAndRefreshMarket(input) {
    try {
      await saveMarketTransaction(input);
    } catch {
      // The finalized on-chain state remains authoritative. A GET refresh asks
      // the backend to rebuild its projection if this optional callback is blocked.
    }
    await refreshMarket();
  }

  async function openListing(asset = '') {
    setBusy(true);
    setNotice('');
    try {
      const connection = wallet || await connectWallet();
      const cars = await loadDatabaseFleet(connection.account.address);
      setOwnedCars(cars);
      setSelectedAsset(asset && cars.some(car => car.asset === asset) ? asset : cars[0]?.asset || '');
      setShowListing(true);
      if (!cars.length) setNotice('This wallet has no transferable Fare Share taxis to list.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleList(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('Approve the on-chain listing transaction in your wallet…');
    try {
      const priceLamports = solToLamports(price);
      const machine = ownedCars.find(car => car.asset === selectedAsset);
      if (!machine) throw new Error('Choose a taxi to list.');
      const signature = await listMachineForSale(wallet, machine, priceLamports, protocolStatus);
      await indexAndRefreshMarket({ action: 'list', signature, asset: selectedAsset, actor: wallet.account.address });
      setShowListing(false);
      setPrice('');
      setNotice('Your taxi is listed on-chain. The marketplace can transfer only this NFT at the listed price.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(listing) {
    setBusy(true);
    setNotice('Approve the on-chain cancellation transaction in your wallet…');
    try {
      const signature = await cancelMachineSale(wallet, listing.asset, protocolStatus);
      await indexAndRefreshMarket({ action: 'cancel', signature, asset: listing.asset, actor: wallet.account.address });
      setNotice('Listing cancelled.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleBuy(listing) {
    setBusy(true);
    setNotice('Approve the atomic SOL-for-NFT purchase in your wallet…');
    try {
      const connection = wallet || await connectWallet();
      const signature = await buyListedMachine(connection, listing, protocolStatus);
      await indexAndRefreshMarket({ action: 'buy', signature, asset: listing.asset, actor: connection.account.address });
      setNotice('Purchase complete. SOL was paid to the seller and the NFT is now in your wallet.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openOffer(asset = '') {
    setBusy(true);
    setNotice('');
    try {
      if (!wallet) await connectWallet();
      setOfferType(asset ? 'asset' : 'model');
      setOfferAsset(asset);
      setShowOffer(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleOffer(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('Approve the escrowed SOL offer in your wallet…');
    try {
      const connection = wallet || await connectWallet();
      const priceLamports = solToLamports(offerPrice);
      const [modelClass, modelVariant] = offerModel.split(':').map(Number);
      const result = offerType === 'asset'
        ? await makeMachineOffer(connection, offerAsset.trim(), priceLamports)
        : offerType === 'model'
          ? await makeModelOffer(connection, modelClass, modelVariant, priceLamports)
          : await makeClassOffer(connection, Number(offerWeight), priceLamports);
      await indexAndRefreshMarket({
        action: offerType === 'asset' ? 'offer-asset' : offerType === 'model' ? 'offer-model' : 'offer-class',
        signature: result.signature,
        offer: result.offer,
        asset: offerType === 'asset' ? offerAsset.trim() : undefined,
        actor: connection.account.address,
      });
      setShowOffer(false);
      setOfferPrice('');
      setNotice('Offer created. Its SOL is locked on-chain until acceptance or cancellation.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOffer(offer) {
    setBusy(true);
    setNotice('Approve cancellation to return the escrowed SOL…');
    try {
      const connection = wallet || await connectWallet();
      const signature = await cancelMarketOffer(connection, offer);
      await indexAndRefreshMarket({ action: 'cancel-offer', signature, offer: offer.id, actor: connection.account.address });
      setNotice('Offer cancelled. Escrowed SOL and account rent were returned.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAcceptOffer(offer) {
    setOpeningOfferId(offer.id);
    setBusy(true);
    setNotice('');
    try {
      const connection = wallet || await connectWallet();
      const cars = await loadDatabaseFleet(connection.account.address);
      const matches = cars.filter(car => offer.kind === 'asset'
        ? car.asset === offer.asset
        : offer.kind === 'model'
          ? car.name.startsWith(`TAXI ${offer.modelName} #`)
          : Number(car.weight) === Number(offer.weight));
      if (!matches.length) throw new Error('This wallet has no eligible taxi for this offer.');
      setEligibleCars(matches);
      setAcceptAsset(matches[0].asset);
      setAcceptingOffer(offer);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setOpeningOfferId(null);
      setBusy(false);
    }
  }

  async function handleAcceptOffer(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('Approve the atomic offer settlement in your wallet…');
    try {
      const connection = wallet || await connectWallet();
      const machine = eligibleCars.find(car => car.asset === acceptAsset);
      if (!machine || !acceptingOffer) throw new Error('Choose an eligible taxi.');
      const signature = await acceptMarketOffer(connection, acceptingOffer, machine, protocolStatus);
      await indexAndRefreshMarket({
        action: 'accept-offer',
        signature,
        offer: acceptingOffer.id,
        asset: machine.asset,
        actor: connection.account.address,
      });
      setAcceptingOffer(null);
      setOwnedCars(cars => cars.filter(car => car.asset !== machine.asset));
      setNotice('Offer accepted. You received SOL and the buyer received the NFT atomically.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function connectForMarket() {
    setBusy(true);
    setNotice('');
    try {
      await connectWallet();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function renderListingCard(listing) {
    return (
      <article className="fare-market-card" key={listing.id}>
        <div className="fare-market-media">
          <FareStepDrivingScene scene={listing} />
          <span className={`fare-fleet-class is-${listing.vehicleClass.tone}`}>{listing.vehicleClass.name}</span>
          <span className="fare-market-nft-number">#{listing.nftNumber}</span>
        </div>
        <div className="fare-market-card-copy">
          <h2>{listing.name}</h2>
          <div className="fare-market-seller">
            <span>SELLER</span>
            <a href={`https://solscan.io/account/${listing.seller}`} target="_blank" rel="noreferrer" aria-label={`View seller ${listing.seller} on Solscan`}>
              {shortWallet(listing.seller)} <b aria-hidden="true">↗</b>
            </a>
          </div>
          <div className="fare-market-price-row">
            <div><span>PRICE</span><strong>{formatSolPrice(listing.price)} SOL</strong></div>
            {walletAddress === String(listing.seller)
              ? <button type="button" disabled={busy} onClick={() => handleCancel(listing)}>CANCEL LISTING</button>
              : <div className="fare-market-card-actions">
                <button className="is-secondary" type="button" disabled={busy} onClick={() => openOffer(listing.asset)}>MAKE OFFER</button>
                <button type="button" disabled={busy} onClick={() => handleBuy(listing)}>{wallet ? 'BUY NOW' : 'CONNECT TO BUY'}</button>
              </div>}
          </div>
        </div>
      </article>
    );
  }

  function renderOfferCard(offer) {
    const assetScene = offer.kind === 'asset'
      ? drivingScenes.find(scene => scene.name === taxiModelName(offer.name))
      : null;
    return (
      <article className="fare-market-card fare-market-offer-card" key={offer.id}>
        {offer.kind !== 'asset'
          ? <ClassOfferDrivingScene className={offer.className} modelName={offer.modelName} />
          : offer.imageUrl && (
            <div className="fare-market-media fare-market-offer-asset-media">
              {assetScene
                ? <FareStepDrivingScene scene={{ ...assetScene, imageUrl: offer.imageUrl }} />
                : <img className="fare-market-offer-asset" src={offer.imageUrl} alt="" loading="lazy" />}
              <span className={`fare-fleet-class is-${String(offer.className || 'economy').toLowerCase()}`}>{offer.className}</span>
              <span className="fare-market-nft-number">#{offer.nftNumber}</span>
            </div>
          )}
        <div className="fare-market-card-copy fare-market-offer-copy">
          <h2>{offer.kind === 'asset' ? (offer.name || shortWallet(offer.asset)) : offer.kind === 'model' ? offer.modelName : `ANY ${String(offer.className).toUpperCase()} TAXI`}</h2>
          <div className="fare-market-seller">
            <span>BUYER</span>
            <a href={`https://solscan.io/account/${offer.buyer}`} target="_blank" rel="noreferrer" aria-label={`View buyer ${offer.buyer} on Solscan`}>
              {shortWallet(offer.buyer)} <b aria-hidden="true">↗</b>
            </a>
          </div>
          <div className="fare-market-price-row">
            <div><span>ESCROWED OFFER</span><strong>{formatLamports(offer.priceLamports)} SOL</strong></div>
            {walletAddress === String(offer.buyer)
              ? <button type="button" disabled={busy} onClick={() => handleCancelOffer(offer)}>CANCEL & RETURN SOL</button>
              : <button type="button" disabled={busy} onClick={() => openAcceptOffer(offer)}>{openingOfferId === offer.id ? 'LOADING TAXIS…' : wallet ? 'SELL TO BUYER' : 'CONNECT TO ACCEPT'}</button>}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
    <main className="fare-market-main" id="top">
      <section className="container fare-market-section" aria-labelledby="market-page-title">
        <header className="fare-market-heading fare-page-heading">
          <div>
            <span className="fare-market-kicker">ATOMIC ON-CHAIN MARKET</span>
            <h1 className="fare-page-title is-short" id="market-page-title">MARKET</h1>
          </div>
          <div className="fare-market-heading-action">
            <p>{mode === 'buy' ? 'Buy a listed taxi now or create a request for the exact model you want.' : mode === 'sell' ? 'See the best live requests for every taxi in your wallet and sell without searching.' : 'Manage your active listings and escrowed buy requests in one place.'}</p>
            <div className="fare-market-heading-buttons">
              {mode === 'buy'
                ? <><button type="button" disabled={busy} onClick={() => openOffer()}>CREATE BUY REQUEST</button><button className="is-secondary" type="button" onClick={() => selectMode('sell')}>I WANT TO SELL</button></>
                : mode === 'sell'
                  ? <><button type="button" disabled={busy} onClick={() => openListing()}>LIST AT YOUR PRICE</button><button className="is-secondary" type="button" onClick={() => selectMode('buy')}>BROWSE TAXIS</button></>
                  : <><button type="button" onClick={() => selectMode('buy')}>BUY A TAXI</button><button className="is-secondary" type="button" onClick={() => selectMode('sell')}>SELL A TAXI</button></>}
            </div>
          </div>
        </header>

        <nav className="fare-market-modes" aria-label="Marketplace mode">
          <button className={mode === 'buy' ? 'is-active' : ''} type="button" aria-current={mode === 'buy' ? 'page' : undefined} onClick={() => selectMode('buy')}><span>BUY A TAXI</span><b>{listings.length}</b></button>
          <button className={mode === 'sell' ? 'is-active' : ''} type="button" aria-current={mode === 'sell' ? 'page' : undefined} onClick={() => selectMode('sell')}><span>SELL A TAXI</span><b>{walletAddress ? matchingOfferCount : offers.length}</b></button>
          <button className={mode === 'mine' ? 'is-active' : ''} type="button" aria-current={mode === 'mine' ? 'page' : undefined} onClick={() => selectMode('mine')}><span>MY ACTIVITY</span><b>{walletAddress ? myListings.length + myOffers.length : 0}</b></button>
        </nav>

        {showOffer && mode === 'buy' && (
          <form className="fare-market-listing-form" onSubmit={handleOffer}>
            <div>
              <span>CREATE BUY REQUEST</span>
              <strong>Offer SOL for one taxi or a whole class</strong>
              <small>The offered SOL is locked on-chain and returned if you cancel.</small>
            </div>
            <label>
              <span>REQUEST TYPE</span>
              <select value={offerType} onChange={event => setOfferType(event.target.value)} disabled={busy}>
                <option value="asset">Specific NFT</option>
                <option value="model">Specific model</option>
                <option value="class">Any taxi in class</option>
              </select>
            </label>
            {offerType === 'asset' ? (
              <label>
                <span>NFT ADDRESS</span>
                <input value={offerAsset} onChange={event => setOfferAsset(event.target.value)} placeholder="Core asset address" disabled={busy} />
              </label>
            ) : offerType === 'model' ? (
              <label>
                <span>TAXI MODEL</span>
                <select value={offerModel} onChange={event => setOfferModel(event.target.value)} disabled={busy}>
                  {CLASS_OPTIONS.map(taxiClass => (
                    <optgroup label={taxiClass.name} key={taxiClass.name}>
                      {MODEL_OPTIONS.filter(model => model.className === taxiClass.name).map(model => (
                        <option value={model.value} key={model.value}>{model.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span>TAXI CLASS</span>
                <select value={offerWeight} onChange={event => setOfferWeight(event.target.value)} disabled={busy}>
                  {CLASS_OPTIONS.map(item => <option value={item.weight} key={item.weight}>{item.name}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>OFFER IN SOL</span>
              <input type="text" inputMode="decimal" placeholder="1.00" value={offerPrice} onChange={event => setOfferPrice(event.target.value)} disabled={busy} />
            </label>
            <div className="fare-market-listing-actions">
              <button className="is-secondary" type="button" onClick={() => setShowOffer(false)} disabled={busy}>CANCEL</button>
              <button type="submit" disabled={busy || !offerPrice.trim() || (offerType === 'asset' && !offerAsset.trim())}>{busy ? 'SIGNING…' : 'LOCK SOL & OFFER'}</button>
            </div>
          </form>
        )}

        {notice && <div className="fare-market-notice" role="status">{notice}<button type="button" aria-label="Close message" onClick={() => setNotice('')}>×</button></div>}

        {mode === 'buy' && (
          <>
            <div className="fare-market-console">
              <div className="fare-market-console-top">
                <div className="fare-market-live"><i aria-hidden="true" /><span>LIVE LISTINGS</span></div>
                <div className="fare-market-summary" aria-label="Marketplace summary">
                  <div><strong>{listings.length}</strong><span>CARS LISTED</span></div>
                  <div><strong>{market.floorLamports === null ? '—' : (Number(market.floorLamports) / 1_000_000_000).toFixed(3)} <small>SOL</small></strong><span>FLOOR PRICE</span></div>
                  <div><strong>{offers.length}</strong><span>BUY REQUESTS</span></div>
                </div>
              </div>
              <div className="fare-market-toolbar">
                <label className="fare-market-search"><span>FIND YOUR TAXI</span><SearchIcon /><input value={query} onChange={event => { setQuery(event.target.value); selectListingPage(1, false); }} placeholder="Model name or NFT #" type="search" /></label>
                <fieldset className="fare-market-classes">
                  <legend>CHOOSE CLASS</legend>
                  {[['all', 'All'], ['economy', 'Economy'], ['comfort', 'Comfort'], ['business', 'Business'], ['legend', 'Legend']].map(([value, label]) => (
                    <button className={vehicleClass === value ? 'is-active' : ''} type="button" aria-pressed={vehicleClass === value} onClick={() => { setVehicleClass(value); selectListingPage(1, false); }} key={value}>{label}</button>
                  ))}
                </fieldset>
                <label className="fare-market-select"><span>SORT CARS</span><select value={sort} onChange={event => { setSort(event.target.value); selectListingPage(1, false); }}><option value="featured">Featured first</option><option value="newest">Newest first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name: A–Z</option></select></label>
              </div>
            </div>
            {visibleListings.length
              ? <><div className="fare-market-grid">{paginatedListings.map(renderListingCard)}</div>
                {listingPageCount > 1 && <nav className="fare-market-pagination" aria-label="Listings pages">
                  <button type="button" disabled={listingPage === 1} onClick={() => selectListingPage(listingPage - 1)}>PREVIOUS</button>
                  <div>{listingPaginationItems.map(item => typeof item === 'number'
                    ? <button className={listingPage === item ? 'is-active' : ''} type="button" aria-current={listingPage === item ? 'page' : undefined} onClick={() => selectListingPage(item)} key={item}>{item}</button>
                    : <span aria-hidden="true" key={item}>…</span>)}</div>
                  <button type="button" disabled={listingPage === listingPageCount} onClick={() => selectListingPage(listingPage + 1)}>NEXT</button>
                </nav>}</>
              : <div className="fare-market-empty"><strong>NO CARS FOUND</strong><p>{hasActiveFilters ? 'Try another model, NFT number, or class.' : 'No taxis are listed right now. Create a buy request for the taxi you want.'}</p>{hasActiveFilters ? <button type="button" onClick={() => { setQuery(''); setVehicleClass('all'); selectListingPage(1, false); }}>SHOW ALL CARS</button> : <button type="button" onClick={() => openOffer()}>CREATE BUY REQUEST</button>}</div>}
            <section className="fare-market-buy-cta"><div><span>CAN'T FIND YOUR TAXI?</span><h2>CREATE A BUY REQUEST</h2><p>Choose one model, a whole class, or one exact NFT. Your SOL stays escrowed on-chain until a seller accepts or you cancel.</p></div><button type="button" disabled={busy} onClick={() => openOffer()}>CREATE REQUEST</button></section>
          </>
        )}

        {mode === 'sell' && (
          <section className="fare-market-sell-view" aria-labelledby="sell-view-title">
            {!walletAddress
              ? <div className="fare-market-intent-empty"><span>SELL A TAXI</span><h2 id="sell-view-title">CONNECT YOUR WALLET</h2><p>See your taxis and every live request that matches them.</p><button type="button" disabled={busy} onClick={connectForMarket}>{busy ? 'CONNECTING…' : 'CONNECT WALLET'}</button></div>
              : fleetLoading
                ? <div className="fare-market-intent-empty"><span>YOUR TAXIS</span><h2 id="sell-view-title">LOADING YOUR FLEET…</h2></div>
                : <>
                  <div className="fare-market-view-heading"><div><span>YOUR WALLET</span><h2 id="sell-view-title">YOUR TAXIS</h2></div><strong>{matchingOfferCount} MATCHING REQUEST{matchingOfferCount === 1 ? '' : 'S'}</strong></div>
                  {sellerCars.length ? <div className="fare-market-seller-grid">{sellerCars.map(car => {
                    const bestOffer = car.matches[0];
                    const nftNumber = Number(car.name.match(/#(\d+)$/)?.[1] || 0);
                    return <article className="fare-market-card fare-market-sell-card" key={car.asset}>
                      <div className="fare-market-media"><FareStepDrivingScene scene={car} /><span className={`fare-fleet-class is-${car.vehicleClass.tone}`}>{car.vehicleClass.name}</span><span className="fare-market-nft-number">#{nftNumber}</span></div>
                      <div className="fare-market-card-copy"><h2>{car.name}</h2>
                        {car.listing
                          ? <div className="fare-market-match is-listed"><span>ACTIVE LISTING</span><strong>{formatLamports(car.listing.priceLamports)} SOL</strong><small>Cancel this listing before accepting another buyer's request.</small></div>
                          : bestOffer
                            ? <div className="fare-market-match"><span>BEST MATCH · {car.matches.length} REQUEST{car.matches.length === 1 ? '' : 'S'}</span><strong>{formatLamports(bestOffer.priceLamports)} SOL</strong><small>{bestOffer.kind === 'class' ? `Any ${bestOffer.className} taxi` : bestOffer.kind === 'model' ? bestOffer.modelName : 'This exact NFT'}</small></div>
                            : <div className="fare-market-match is-empty"><span>NO MATCHING REQUESTS</span><small>List this taxi at your own price.</small></div>}
                        <div className="fare-market-sell-actions">{car.listing ? <button type="button" disabled={busy} onClick={() => handleCancel(car.listing)}>CANCEL LISTING</button> : bestOffer && <button type="button" disabled={busy} onClick={() => openAcceptOffer(bestOffer)}>SELL NOW · {formatLamports(bestOffer.priceLamports)} SOL</button>}<button className="is-secondary" type="button" disabled={busy || Boolean(car.listing)} onClick={() => openListing(car.asset)}>LIST AT YOUR PRICE</button></div>
                      </div>
                    </article>;
                  })}</div> : <div className="fare-market-intent-empty"><span>YOUR TAXIS</span><h2>NO TAXIS IN THIS WALLET</h2><p>Buy or mint a taxi before creating a sale listing.</p><div><button type="button" onClick={() => selectMode('buy')}>BUY A TAXI</button><a href={appAssetPath('/mint/')}>MINT A TAXI</a></div></div>}
                  <div className="fare-market-all-requests"><button type="button" onClick={() => setShowAllOffers(value => !value)}>{showAllOffers ? 'HIDE ALL BUY REQUESTS' : `SHOW ALL BUY REQUESTS · ${offers.length}`}</button></div>
                  {showAllOffers && (offers.length ? <div className="fare-market-offer-grid">{offers.filter(offer => String(offer.buyer) !== walletAddress).map(renderOfferCard)}</div> : <div className="fare-market-offers-empty">NO ACTIVE BUY REQUESTS</div>)}
                </>}
          </section>
        )}

        {mode === 'mine' && (
          <section className="fare-market-mine-view" aria-labelledby="mine-view-title">
            {!walletAddress
              ? <div className="fare-market-intent-empty"><span>MY ACTIVITY</span><h2 id="mine-view-title">CONNECT YOUR WALLET</h2><p>Manage your listings and escrowed buy requests.</p><button type="button" disabled={busy} onClick={connectForMarket}>{busy ? 'CONNECTING…' : 'CONNECT WALLET'}</button></div>
              : <><div className="fare-market-view-heading"><div><span>CONNECTED WALLET</span><h2 id="mine-view-title">MY ACTIVITY</h2></div><strong>{shortWallet(walletAddress)}</strong></div>
                <section className="fare-market-personal-section"><div className="fare-market-personal-heading"><h3>MY LISTINGS</h3><button type="button" onClick={() => selectMode('sell')}>LIST ANOTHER TAXI</button></div>{myListings.length ? <div className="fare-market-grid is-personal">{myListings.map(renderListingCard)}</div> : <div className="fare-market-offers-empty">YOU HAVE NO ACTIVE LISTINGS</div>}</section>
                <section className="fare-market-personal-section"><div className="fare-market-personal-heading"><h3>MY BUY REQUESTS</h3><button type="button" onClick={() => { selectMode('buy'); window.setTimeout(() => openOffer(), 0); }}>CREATE REQUEST</button></div>{myOffers.length ? <div className="fare-market-offer-grid">{myOffers.map(renderOfferCard)}</div> : <div className="fare-market-offers-empty">YOU HAVE NO ACTIVE BUY REQUESTS</div>}</section>
              </>}
          </section>
        )}
      </section>
    </main>
    {showListing && mode === 'sell' && createPortal(
      <div
        className="fare-market-modal-backdrop"
        onMouseDown={event => { if (event.target === event.currentTarget && !busy) setShowListing(false); }}
      >
        <form className="fare-market-listing-modal" role="dialog" aria-modal="true" aria-labelledby="create-listing-title" onSubmit={handleList}>
          <div className="fare-market-accept-header">
            <div>
              <span>SELL YOUR TAXI</span>
              <h2 id="create-listing-title">CREATE LISTING</h2>
            </div>
            <button className="fare-market-modal-close" type="button" aria-label="Close listing dialog" disabled={busy} onClick={() => setShowListing(false)}>×</button>
          </div>
          <div className="fare-market-listing-intro">
            <strong>Choose a taxi and set its price</strong>
            <small>Your NFT stays in your wallet. The on-chain delegate can transfer it only through the listed sale.</small>
          </div>
          {notice && <div className="fare-market-accept-notice" role="status">{notice}</div>}
          <div className="fare-market-listing-fields">
            <label>
              <span>TAXI</span>
              <select value={selectedAsset} onChange={event => setSelectedAsset(event.target.value)} disabled={!ownedCars.length || busy}>
                {ownedCars.map(car => <option value={car.asset} key={car.asset}>{car.name}</option>)}
              </select>
            </label>
            <label>
              <span>PRICE IN SOL</span>
              <input type="text" inputMode="decimal" placeholder="1.25" value={price} onChange={event => setPrice(event.target.value)} disabled={busy} autoFocus />
            </label>
          </div>
          <div className="fare-market-listing-modal-actions">
            <button className="is-secondary" type="button" onClick={() => setShowListing(false)} disabled={busy}>CANCEL</button>
            <button type="submit" disabled={busy || !selectedAsset || !price.trim()}>{busy ? 'SIGNING…' : 'LIST FOR SALE'}</button>
          </div>
        </form>
      </div>,
      document.body,
    )}
    {acceptingOffer && createPortal(
      <div
        className="fare-market-modal-backdrop"
        onMouseDown={event => { if (event.target === event.currentTarget && !busy) setAcceptingOffer(null); }}
      >
        <form className="fare-market-accept-modal" role="dialog" aria-modal="true" aria-labelledby="accept-offer-title" onSubmit={handleAcceptOffer}>
          <div className="fare-market-accept-header">
            <div>
              <span>ATOMIC ON-CHAIN SALE</span>
              <h2 id="accept-offer-title">SELL TO BUYER</h2>
            </div>
            <button className="fare-market-modal-close" type="button" aria-label="Close sale dialog" disabled={busy} onClick={() => setAcceptingOffer(null)} autoFocus>×</button>
          </div>
          <div className="fare-market-accept-summary">
            <span>YOU RECEIVE</span>
            <strong>{formatLamports(acceptingOffer.priceLamports)} SOL</strong>
            <small>The selected NFT and escrowed SOL exchange atomically.</small>
          </div>
          {notice && <div className="fare-market-accept-notice" role="status">{notice}</div>}
          <fieldset className="fare-market-accept-cars">
            <legend>CHOOSE THE TAXI YOU WANT TO SELL</legend>
            <div>
              {eligibleCars.map(car => (
                <label className={acceptAsset === car.asset ? 'is-selected' : ''} key={car.asset}>
                  <input type="radio" name="acceptAsset" value={car.asset} checked={acceptAsset === car.asset} onChange={() => setAcceptAsset(car.asset)} disabled={busy} />
                  <img src={car.image} alt="" loading="eager" />
                  <span><strong>{car.name}</strong><small>{shortWallet(car.asset)}</small></span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
          <div className="fare-market-accept-actions">
            <button className="is-secondary" type="button" onClick={() => setAcceptingOffer(null)} disabled={busy}>CANCEL</button>
            <button type="submit" disabled={busy || !acceptAsset}>{busy ? 'SIGNING…' : 'SELL SELECTED TAXI'}</button>
          </div>
        </form>
      </div>,
      document.body,
    )}
    </>
  );
}

function solToLamports(value) {
  const normalized = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(normalized)) throw new Error('Enter a valid SOL price with up to 9 decimal places.');
  const [whole, fraction = ''] = normalized.split('.');
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0');
  if (lamports <= 0n) throw new Error('Price must be greater than zero.');
  return lamports.toString();
}

function formatSolPrice(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 9 }).format(value);
}

function formatLamports(value) {
  return formatSolPrice(Number(value) / 1_000_000_000);
}
