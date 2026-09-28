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

export function GaragePage() {
  return (
    <>
      <main className="fare-garage-main" id="top">
        <section className="container fare-garage-section" id="garage" aria-labelledby="garage-page-title">
          <div className="fare-garage-heading">
            <h1 id="garage-page-title">GARAGE</h1>
            <p>Your taxi fleet, ready to run the next shift.</p>
          </div>

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
