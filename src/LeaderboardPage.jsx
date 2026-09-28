import { useEffect, useRef, useState } from 'react';

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
  const currentDriverRef = useRef(null);
  const [currentDriverVisible, setCurrentDriverVisible] = useState(true);
  const [footerVisible, setFooterVisible] = useState(false);

  useEffect(() => {
    const row = currentDriverRef.current;
    if (!row) return undefined;
    const observer = new IntersectionObserver(([entry]) => setCurrentDriverVisible(entry.isIntersecting), { threshold: .2 });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const footer = document.querySelector('.fare-footer');
    if (!footer) return undefined;
    const observer = new IntersectionObserver(([entry]) => setFooterVisible(entry.isIntersecting));
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const dockHidden = currentDriverVisible || footerVisible;

  return (
    <>
      <main className="fare-leaderboard-page-main" id="top">
        <section className="container fare-leaderboard-page-section" aria-labelledby="leaderboard-page-title">
          <div className="fare-leaderboard-page-heading fare-page-heading">
            <h1 className="fare-page-title is-long" id="leaderboard-page-title">LEADERBOARD</h1>
            <p>Top drivers ranked by total fleet earnings.</p>
          </div>

          <div className="fare-leaderboard fare-leaderboard-full">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>TOTAL EARNINGS</span>
            </div>
            {leaders.map(([driver, cars, earnings], index) => (
              <div className={`fare-leaderboard-row${index === 0 ? ' is-current-driver' : ''}`} key={driver} ref={index === 0 ? currentDriverRef : undefined}>
                <span>{index + 1}</span>
                <span className="fare-driver-cell"><img src="/brand/fare-driver.png" alt="" loading="lazy" decoding="async" /><span className="fare-driver-name">{driver}{index === 0 && <strong className="fare-you-badge">YOU</strong>}</span></span>
                <span>{cars} Cars</span>
                <span>{earnings}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <div className={`fare-current-driver-dock${dockHidden ? ' is-hidden' : ''}`} aria-hidden={dockHidden}>
        <span>1</span>
        <span className="fare-driver-cell"><img src="/brand/fare-driver.png" alt="" decoding="async" /><span className="fare-driver-name">User_4312234<strong className="fare-you-badge">YOU</strong></span></span>
        <span>12 Cars</span>
        <span>24 430$</span>
      </div>

    </>
  );
}
