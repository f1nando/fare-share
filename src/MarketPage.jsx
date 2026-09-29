import { useEffect, useMemo, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import { loadPublicMarket } from './publicData.js';
import './market.css';

const CLASS_BY_NAME = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map(name => [name, { name: 'Economy', tone: 'economy' }]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map(name => [name, { name: 'Comfort', tone: 'comfort' }]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map(name => [name, { name: 'Business', tone: 'business' }]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map(name => [name, { name: 'Legend', tone: 'legend' }]),
]);

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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function MarketPage({ wallet, connectWallet }) {
  const [query, setQuery] = useState('');
  const [vehicleClass, setVehicleClass] = useState('all');
  const [sort, setSort] = useState('featured');
  const [notice, setNotice] = useState('');
  const [market, setMarket] = useState({ listings: [], floorLamports: null, totalVolumeLamports: '0' });

  useEffect(() => {
    let active = true;
    loadPublicMarket().then(value => active && setMarket(value)).catch(error => active && setNotice(error.message));
    return () => { active = false; };
  }, []);

  const listings = market.listings.map(listing => ({
    ...listing,
    price: Number(listing.priceLamports) / 1_000_000_000,
    vehicleClass: CLASS_BY_NAME.get(listing.name) || { name: listing.className || 'Economy', tone: String(listing.className || 'economy').toLowerCase() },
  }));

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...listings]
      .filter(listing => vehicleClass === 'all' || listing.vehicleClass.tone === vehicleClass)
      .filter(listing => !normalizedQuery || `${listing.name} ${listing.vehicleClass.name} ${listing.nftNumber}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(SORTERS[sort]);
  }, [listings, query, sort, vehicleClass]);
  const hasActiveFilters = Boolean(query.trim()) || vehicleClass !== 'all';

  async function handleBuy(listing) {
    if (!wallet) {
      try {
        await connectWallet();
        setNotice(`Wallet connected. ${listing.name} #${listing.nftNumber} is ready for checkout.`);
      } catch (error) {
        setNotice(error.message);
      }
      return;
    }
    setNotice(`${listing.name} #${listing.nftNumber} is ready for checkout.`);
  }

  return (
    <main className="fare-market-main" id="top">
      <section className="container fare-market-section" aria-labelledby="market-page-title">
        <header className="fare-market-heading fare-page-heading">
          <div>
            <span className="fare-market-kicker">OFFICIAL COLLECTION</span>
            <h1 className="fare-page-title is-short" id="market-page-title">MARKET</h1>
          </div>
          <p>Find your next taxi. Every car is ready to join your fleet.</p>
        </header>

        <div className="fare-market-console">
          <div className="fare-market-console-top">
            <div className="fare-market-live"><i aria-hidden="true" /><span>LIVE MARKET</span></div>
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
                    <div><span>PRICE</span><strong>{listing.price.toFixed(2)} SOL</strong></div>
                    <button type="button" onClick={() => handleBuy(listing)}>{wallet ? 'BUY NOW' : 'CONNECT TO BUY'}</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="fare-market-empty">
            <strong>NO CARS FOUND</strong>
            <p>{hasActiveFilters ? 'Try another model, NFT number, or class.' : 'No cars are listed right now. Mint a new taxi for your fleet.'}</p>
            {hasActiveFilters
              ? <button type="button" onClick={() => { setQuery(''); setVehicleClass('all'); }}>SHOW ALL CARS</button>
              : <a href="/mint/">GO TO MINT</a>}
          </div>
        )}
      </section>
    </main>
  );
}
