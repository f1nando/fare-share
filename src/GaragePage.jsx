import { FareFooter, FareHeader } from './FareShareChrome.jsx';
import { FareShareCityBackground, FareStepDrivingScene } from './FareShareLanding.jsx';
import drivingScenes from './drivingScenes.json';

const garageCars = drivingScenes.slice(0, 9);

export function GaragePage() {
  return (
    <div className="fare-page fare-garage-page">
      <FareShareCityBackground />
      <FareHeader linkPrefix="/fare-share/" activeItem="garage" />

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
                <h2>{car.name}</h2>
                <p>Ready to run a shift.</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <FareFooter linkPrefix="/fare-share/" />
    </div>
  );
}
