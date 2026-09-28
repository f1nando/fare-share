import { FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';

const CLASS_BY_SCENE = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map(name => [name, { name: 'Economy', tone: 'economy' }]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map(name => [name, { name: 'Comfort', tone: 'comfort' }]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map(name => [name, { name: 'Business', tone: 'business' }]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map(name => [name, { name: 'Legend', tone: 'legend' }]),
]);
const GARAGE_STATS = [
  { durability: 84, fare: '12.48', stocks: '$3.20 in stocks' },
  { durability: 62, fare: '8.14', stocks: '$2.05 in stocks' },
  { durability: 28, fare: '19.72', stocks: '$4.91 in stocks' },
  { durability: 100, fare: '3.06', stocks: '$0.78 in stocks' },
  { durability: 47, fare: '6.83', stocks: '$1.69 in stocks' },
  { durability: 73, fare: '31.44', stocks: '$7.86 in stocks' },
  { durability: 91, fare: '74.20', stocks: '$18.55 in stocks' },
  { durability: 36, fare: '11.57', stocks: '$2.88 in stocks' },
  { durability: 15, fare: '52.09', stocks: '$13.02 in stocks' },
];
const garageCars = drivingScenes.slice(0, 9).map((scene, index) => ({
  ...scene,
  ...GARAGE_STATS[index],
  vehicleClass: CLASS_BY_SCENE.get(scene.name) || { name: 'Economy', tone: 'economy' },
}));
const earningsBars = [38, 46, 34, 51, 62, 73, 71, 72, 70, 69, 58, 57, 59, 56, 55, 57, 56, 64, 63, 62, 94, 94, 94, 108];

export function GaragePage() {
  return (
    <>
      <main className="fare-garage-main" id="top">
        <section className="container fare-garage-section" id="garage" aria-labelledby="garage-page-title">
          <div className="fare-garage-heading">
            <h1 id="garage-page-title">GARAGE</h1>
            <p>Your taxi fleet, ready to run the next shift.</p>
          </div>

          <section className="fare-garage-overview" aria-label="Fleet earnings overview">
            <div className="fare-garage-overview-main">
              <div className="fare-garage-overview-copy">
                <span>Total fleet earnings</span>
                <strong>219.53 FARE</strong>
                <p>+$12.48 today · $54.94 earned in stocks</p>
                <div className="fare-garage-overview-actions">
                  <button type="button">Claim all <b>219.53</b></button>
                  <button className="is-secondary" type="button">Repair all</button>
                </div>
              </div>

              <div className="fare-garage-chart">
                <div className="fare-garage-periods" aria-label="Earnings period">
                  <button className="is-active" type="button">24H</button>
                  <button type="button">7D</button>
                  <button type="button">30D</button>
                </div>
                <div className="fare-garage-bars" aria-hidden="true">
                  {earningsBars.map((height, index) => <i className={index > 9 ? 'is-accent' : undefined} style={{ height: `${height}px` }} key={`${height}-${index}`} />)}
                </div>
                <div className="fare-garage-chart-labels"><span>00:00</span><span>06:00</span><span>12:30</span><span>16:30</span><span>20:00</span><span>00:00</span></div>
              </div>
            </div>

            <div className="fare-garage-overview-stats">
              <div><span>Earned this hour</span><strong>4.82 FARE</strong><small className="is-positive">↗ 8.4%</small></div>
              <div><span>Projected today</span><strong>57.60 FARE</strong><small>Estimate</small></div>
              <div><span>Cars working</span><strong>7/9</strong><small>2 need repair</small></div>
            </div>
          </section>

          <div className="fare-garage-grid">
            {garageCars.map((car, index) => (
              <article className="fare-step-card fare-garage-card" key={car.id}>
                <FareStepDrivingScene scene={car} />
                <span className="fare-step-number fare-garage-number">#{String(index + 1).padStart(2, '0')}</span>
                <span className={`fare-fleet-class fare-garage-class is-${car.vehicleClass.tone}`}>{car.vehicleClass.name}</span>
                <h2>{car.name}</h2>
                <div className="fare-garage-durability-copy"><span>Durability</span><strong>{car.durability}%</strong></div>
                <div className="fare-garage-durability" role="progressbar" aria-label={`${car.name} durability`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={car.durability}>
                  <span style={{ width: `${car.durability}%` }} />
                </div>
                <div className="fare-garage-earned">
                  <span>Earned</span>
                  <strong>{car.fare} FARE</strong>
                  <small>{car.stocks}</small>
                </div>
                <div className="fare-garage-actions">
                  <button className="is-secondary" type="button">Repair</button>
                  <button type="button">Claim</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
