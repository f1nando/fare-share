import { FareFooter, FareHeader } from './FareShareChrome.jsx';
import { FareShareCityBackground } from './FareShareLanding.jsx';

const leaders = [
  ['User_4312234', 12, '24 430$'],
  ['TaxiKing_88', 10, '21 842$'],
  ['yellowcab.sol', 9, '19 705$'],
  ['Driver_0707', 9, '18 492$'],
  ['ParkBoss', 8, '17 886$'],
  ['ShiftRunner', 8, '16 204$'],
  ['cabcollector', 7, '15 918$'],
  ['UrbanRider', 7, '14 773$'],
  ['NightShift', 6, '13 660$'],
  ['TokenDriver', 6, '12 944$'],
  ['FareHunter', 6, '12 105$'],
  ['CityCruiser', 5, '11 882$'],
  ['StockCab', 5, '10 764$'],
  ['RoadLegend', 5, '9 931$'],
  ['MeterMaster', 4, '9 248$'],
  ['Cab_2049', 4, '8 675$'],
  ['RushHour', 4, '8 102$'],
  ['GreenLight', 3, '7 546$'],
  ['StreetAlpha', 3, '6 934$'],
  ['TaxiPilot', 3, '6 408$'],
];

export function LeaderboardPage() {
  return (
    <div className="fare-page fare-leaderboard-page">
      <FareShareCityBackground />
      <FareHeader linkPrefix="/fare-share/" />

      <main className="fare-leaderboard-page-main" id="top">
        <section className="container fare-leaderboard-page-section" aria-labelledby="leaderboard-page-title">
          <div className="fare-leaderboard-page-heading">
            <h1 id="leaderboard-page-title">LEADERBOARD</h1>
            <p>Top drivers ranked by total fleet earnings.</p>
          </div>

          <div className="fare-leaderboard fare-leaderboard-full">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>TOTAL EARNINGS</span>
            </div>
            {leaders.map(([driver, cars, earnings], index) => (
              <div className="fare-leaderboard-row" key={driver}>
                <span>{index + 1}</span>
                <span className="fare-driver-cell"><img src="/brand/fare-driver.png" alt="" loading="lazy" decoding="async" />{driver}</span>
                <span>{cars} Cars</span>
                <span>{earnings}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <FareFooter linkPrefix="/fare-share/" />
    </div>
  );
}
