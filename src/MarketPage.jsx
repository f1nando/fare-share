import { useEffect, useMemo, useState } from 'react';
import { FareStepDrivingScene } from './FareShareLanding.jsx';
import { loadDatabaseFleet, loadPublicMarket, saveMarketTransaction } from './publicData.js';
import { buyListedMachine, cancelMachineSale, listMachineForSale, loadProtocolStatus } from './protocol/solana.js';
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
  const [protocolStatus, setProtocolStatus] = useState(null);
  const [showListing, setShowListing] = useState(false);
  const [ownedCars, setOwnedCars] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadPublicMarket(), loadProtocolStatus()])
      .then(([value, status]) => { if (active) { setMarket(value); setProtocolStatus(status); } })
      .catch(error => active && setNotice(error.message));
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

  async function refreshMarket() {
    setMarket(await loadPublicMarket());
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
      await saveMarketTransaction({ action: 'list', signature, asset: selectedAsset, actor: wallet.account.address });
      await refreshMarket();
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
      await saveMarketTransaction({ action: 'cancel', signature, asset: listing.asset, actor: wallet.account.address });
      await refreshMarket();
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
      await saveMarketTransaction({ action: 'buy', signature, asset: listing.asset, actor: connection.account.address });
      await refreshMarket();
      setNotice('Purchase complete. SOL was paid to the seller and the NFT is now in your wallet.');
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
            <button type="button" disabled={busy} onClick={openListing}>LIST YOUR NFT</button>
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
                      : <button type="button" disabled={busy} onClick={() => handleBuy(listing)}>{wallet ? 'BUY NOW' : 'CONNECT TO BUY'}</button>}
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
