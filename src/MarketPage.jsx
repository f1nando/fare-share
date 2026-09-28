import { useMemo, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';
import './market.css';

const CLASS_BY_NAME = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map(name => [name, { name: 'Economy', tone: 'economy' }]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map(name => [name, { name: 'Comfort', tone: 'comfort' }]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map(name => [name, { name: 'Business', tone: 'business' }]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map(name => [name, { name: 'Legend', tone: 'legend' }]),
]);

const PRICE_BY_INDEX = [0.82, 0.94, 1.18, 0.76, 1.05, 5.9, 4.25, 1.72, 7.4, 3.85, 1.48, 4.7, 3.35, 1.36, 2.95, 3.65];
const SELLERS = ['8fK2...xP9m', 'Hq4R...2Ka7', 'D7vx...pL31', 'B5ma...9Qe2', '3UtN...v8Wk'];

const listings = drivingScenes.map((scene, index) => ({
  ...scene,
  nftNumber: 1042 + index * 37,
  price: PRICE_BY_INDEX[index],
  seller: SELLERS[index % SELLERS.length],
  listedAt: 16 - index,
  vehicleClass: CLASS_BY_NAME.get(scene.name) || { name: 'Economy', tone: 'economy' },
}));

const SORTERS = {
  featured: (left, right) => left.listedAt - right.listedAt,
  newest: (left, right) => right.nftNumber - left.nftNumber,
  'price-low': (left, right) => left.price - right.price,
  'price-high': (left, right) => right.price - left.price,
  name: (left, right) => left.name.localeCompare(right.name),
};

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

  const visibleListings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...listings]
      .filter(listing => vehicleClass === 'all' || listing.vehicleClass.tone === vehicleClass)
      .filter(listing => !normalizedQuery || `${listing.name} ${listing.vehicleClass.name} ${listing.nftNumber}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort(SORTERS[sort]);
  }, [query, sort, vehicleClass]);

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
        <header className="fare-market-heading">
          <div>
            <span className="fare-market-kicker">OFFICIAL COLLECTION</span>
            <h1 id="market-page-title">MARKET</h1>
          </div>
          <p>Find your next taxi. Every car is ready to join your fleet.</p>
        </header>

        <div className="fare-market-summary" aria-label="Marketplace summary">
          <div><strong>{listings.length}</strong><span>CARS LISTED</span></div>
          <div><strong>0.76 SOL</strong><span>FLOOR PRICE</span></div>
          <div><strong>41.2 SOL</strong><span>TOTAL VOLUME</span></div>
        </div>

        <div className="fare-market-toolbar">
          <label className="fare-market-search">
            <span className="sr-only">Search cars</span>
            <SearchIcon />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by model or NFT #" type="search" />
          </label>

          <label className="fare-market-select">
            <span>CLASS</span>
            <select value={vehicleClass} onChange={event => setVehicleClass(event.target.value)}>
              <option value="all">All classes</option>
              <option value="economy">Economy</option>
              <option value="comfort">Comfort</option>
              <option value="business">Business</option>
              <option value="legend">Legend</option>
            </select>
          </label>

          <label className="fare-market-select">
            <span>SORT BY</span>
            <select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="name">Name: A–Z</option>
            </select>
          </label>
        </div>

        <div className="fare-market-results">
          <strong>{visibleListings.length} {visibleListings.length === 1 ? 'CAR' : 'CARS'}</strong>
          {(query || vehicleClass !== 'all') && <button type="button" onClick={() => { setQuery(''); setVehicleClass('all'); }}>Clear filters</button>}
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
                  <div className="fare-market-seller"><span>SELLER</span><strong>{listing.seller}</strong></div>
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
            <p>Try another model, NFT number, or class.</p>
            <button type="button" onClick={() => { setQuery(''); setVehicleClass('all'); }}>SHOW ALL CARS</button>
          </div>
        )}
      </section>
    </main>
  );
}
