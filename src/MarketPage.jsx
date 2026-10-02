import { useEffect, useMemo, useState } from 'react';
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
            <FareStepDrivingScene scene={item} showHeadlights={false} imageLoading="eager" />
          </div>
        ))}
      </div>
      <span className="fare-market-offer-model">{scene.name}</span>
      <span className={`fare-fleet-class fare-market-offer-class is-${String(className || 'economy').toLowerCase()}`}>{className}</span>
    </div>
  );
}

export function MarketPage({ wallet, connectWallet }) {
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadPublicMarket(), loadProtocolStatus()])
      .then(([value, status]) => { if (active) { setMarket(value); setProtocolStatus(status); } })
      .catch(error => active && setNotice(error.message));
    return () => { active = false; };
  }, []);

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
  const offers = market.offers || [];

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

  async function openListing() {
    setBusy(true);
    setNotice('');
    try {
      const connection = wallet || await connectWallet();
      const cars = await loadDatabaseFleet(connection.account.address);
      setOwnedCars(cars);
      setSelectedAsset(cars[0]?.asset || '');
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
      setNotice('Offer accepted. You received SOL and the buyer received the NFT atomically.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="fare-market-main" id="top">
      <section className="container fare-market-section" aria-labelledby="market-page-title">
        <header className="fare-market-heading fare-page-heading">
          <div>
            <span className="fare-market-kicker">ATOMIC ON-CHAIN MARKET</span>
            <h1 className="fare-page-title is-short" id="market-page-title">MARKET</h1>
          </div>
          <div className="fare-market-heading-action">
            <p>List a taxi at your price or buy one atomically with SOL. Fare Share never holds your NFT or payment.</p>
            <div className="fare-market-heading-buttons">
              <button type="button" disabled={busy} onClick={openListing}>LIST YOUR NFT</button>
              <button className="is-secondary" type="button" disabled={busy} onClick={() => openOffer()}>CREATE BUY REQUEST</button>
            </div>
          </div>
        </header>

        {showListing && (
          <form className="fare-market-listing-form" onSubmit={handleList}>
            <div>
              <span>CREATE LISTING</span>
              <strong>Choose a taxi and set its price</strong>
              <small>Your NFT stays in your wallet. The on-chain delegate can transfer it only through the listed sale.</small>
            </div>
            <label>
              <span>TAXI</span>
              <select value={selectedAsset} onChange={event => setSelectedAsset(event.target.value)} disabled={!ownedCars.length || busy}>
                {ownedCars.map(car => <option value={car.asset} key={car.asset}>{car.name}</option>)}
              </select>
            </label>
            <label>
              <span>PRICE IN SOL</span>
              <input type="text" inputMode="decimal" placeholder="1.25" value={price} onChange={event => setPrice(event.target.value)} disabled={busy} />
            </label>
            <div className="fare-market-listing-actions">
              <button className="is-secondary" type="button" onClick={() => setShowListing(false)} disabled={busy}>CANCEL</button>
              <button type="submit" disabled={busy || !selectedAsset || !price.trim()}>{busy ? 'SIGNING…' : 'LIST FOR SALE'}</button>
            </div>
          </form>
        )}

        {showOffer && (
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

        {acceptingOffer && (
          <form className="fare-market-listing-form" onSubmit={handleAcceptOffer}>
            <div>
              <span>ACCEPT BUY REQUEST</span>
              <strong>{formatLamports(acceptingOffer.priceLamports)} SOL</strong>
              <small>The NFT and escrowed SOL exchange atomically.</small>
            </div>
            <label>
              <span>YOUR ELIGIBLE TAXI</span>
              <select value={acceptAsset} onChange={event => setAcceptAsset(event.target.value)} disabled={busy}>
                {eligibleCars.map(car => <option value={car.asset} key={car.asset}>{car.name}</option>)}
              </select>
            </label>
            <div className="fare-market-listing-actions">
              <button className="is-secondary" type="button" onClick={() => setAcceptingOffer(null)} disabled={busy}>BACK</button>
              <button type="submit" disabled={busy || !acceptAsset}>{busy ? 'SIGNING…' : 'ACCEPT OFFER'}</button>
            </div>
          </form>
        )}

        <div className="fare-market-console">
          <div className="fare-market-console-top">
            <div className="fare-market-live"><i aria-hidden="true" /><span>LIVE LISTINGS</span></div>
            <div className="fare-market-summary" aria-label="Marketplace summary">
              <div><strong>{listings.length}</strong><span>CARS LISTED</span></div>
              <div><strong>{market.floorLamports === null ? '—' : (Number(market.floorLamports) / 1_000_000_000).toFixed(3)} <small>SOL</small></strong><span>FLOOR PRICE</span></div>
              <div><strong>{(Number(market.totalVolumeLamports) / 1_000_000_000).toFixed(3)} <small>SOL</small></strong><span>VERIFIED VOLUME</span></div>
            </div>
          </div>

          <div className="fare-market-toolbar">
            <label className="fare-market-search">
              <span>FIND YOUR TAXI</span>
              <SearchIcon />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Model name or NFT #" type="search" />
            </label>

            <fieldset className="fare-market-classes">
              <legend>CHOOSE CLASS</legend>
              {[
                ['all', 'All'],
                ['economy', 'Economy'],
                ['comfort', 'Comfort'],
                ['business', 'Business'],
                ['legend', 'Legend'],
              ].map(([value, label]) => (
                <button className={vehicleClass === value ? 'is-active' : ''} type="button" aria-pressed={vehicleClass === value} onClick={() => setVehicleClass(value)} key={value}>{label}</button>
              ))}
            </fieldset>

            <label className="fare-market-select">
              <span>SORT CARS</span>
              <select value={sort} onChange={event => setSort(event.target.value)}>
                <option value="featured">Featured first</option>
                <option value="newest">Newest first</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
                <option value="name">Name: A–Z</option>
              </select>
            </label>
          </div>
        </div>

        {notice && <div className="fare-market-notice" role="status">{notice}<button type="button" aria-label="Close message" onClick={() => setNotice('')}>×</button></div>}

        {visibleListings.length ? (
          <div className="fare-market-grid">
            {visibleListings.map(listing => (
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
                    {wallet?.account.address === listing.seller
                      ? <button type="button" disabled={busy} onClick={() => handleCancel(listing)}>CANCEL LISTING</button>
                      : <div className="fare-market-card-actions">
                        <button className="is-secondary" type="button" disabled={busy} onClick={() => openOffer(listing.asset)}>MAKE OFFER</button>
                        <button type="button" disabled={busy} onClick={() => handleBuy(listing)}>{wallet ? 'BUY NOW' : 'CONNECT TO BUY'}</button>
                      </div>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="fare-market-empty">
            <strong>NO CARS FOUND</strong>
              <p>{hasActiveFilters ? 'Try another model, NFT number, or class.' : 'No taxis are listed yet. Be the first owner to create a listing.'}</p>
              {hasActiveFilters
                ? <button type="button" onClick={() => { setQuery(''); setVehicleClass('all'); }}>SHOW ALL CARS</button>
                : <button type="button" onClick={openListing}>LIST YOUR NFT</button>}
          </div>
        )}


        <section className="fare-market-offers" aria-labelledby="market-offers-title">
          <div className="fare-market-offers-heading">
            <div><span>ESCROWED ON-CHAIN</span><h2 id="market-offers-title">BUY REQUESTS</h2></div>
            <button type="button" disabled={busy} onClick={() => openOffer()}>CREATE REQUEST</button>
          </div>
          {offers.length ? (
            <div className="fare-market-offer-grid">
              {offers.map(offer => (
                <article className="fare-market-card fare-market-offer-card" key={offer.id}>
                  {offer.kind !== 'asset'
                    ? <ClassOfferDrivingScene className={offer.className} modelName={offer.modelName} />
                    : offer.imageUrl && (
                      <div className="fare-market-media fare-market-offer-asset-media">
                        <img className="fare-market-offer-asset" src={offer.imageUrl} alt="" loading="lazy" />
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
                      {wallet?.account.address === offer.buyer
                        ? <button type="button" disabled={busy} onClick={() => handleCancelOffer(offer)}>CANCEL & RETURN SOL</button>
                        : <button type="button" disabled={busy} onClick={() => openAcceptOffer(offer)}>{wallet ? 'SELL TO BUYER' : 'CONNECT TO ACCEPT'}</button>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="fare-market-offers-empty">NO ACTIVE BUY REQUESTS</div>}
        </section>
      </section>
    </main>
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
