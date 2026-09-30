import { useEffect, useRef, useState } from 'react';
import { loadPublicOverview } from './publicData.js';

export function LeaderboardPage({ wallet }) {
  const currentDriverRef = useRef(null);
  const [currentDriverVisible, setCurrentDriverVisible] = useState(true);
  const [footerVisible, setFooterVisible] = useState(false);
  const [leaders, setLeaders] = useState([]);
  const [notice, setNotice] = useState('Loading verified fleet data…');

  useEffect(() => {
    let active = true;
    loadPublicOverview()
      .then(result => {
        if (!active) return;
        setLeaders(result.leaders || []);
        setNotice(result.leaders?.length ? '' : 'No verified fleet owners yet.');
      })
      .catch(error => active && setNotice(error.message));
    return () => { active = false; };
  }, []);

  const currentOwner = wallet ? String(wallet.account.address) : '';
  const currentIndex = leaders.findIndex(leader => leader.owner === currentOwner);
  const currentLeader = currentIndex >= 0 ? leaders[currentIndex] : null;

  useEffect(() => {
    const row = currentDriverRef.current;
    if (!row) return undefined;
    const observer = new IntersectionObserver(([entry]) => setCurrentDriverVisible(entry.isIntersecting), { threshold: .2 });
    observer.observe(row);
    return () => observer.disconnect();
  }, [currentIndex]);

  useEffect(() => {
    const footer = document.querySelector('.fare-footer');
    if (!footer) return undefined;
    const observer = new IntersectionObserver(([entry]) => setFooterVisible(entry.isIntersecting));
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  const dockHidden = !currentLeader || currentDriverVisible || footerVisible;

  return (
    <>
      <main className={`fare-leaderboard-page-main${leaders.length === 0 ? ' is-empty' : ''}`} id="top">
        <section className="container fare-leaderboard-page-section" aria-labelledby="leaderboard-page-title">
          <div className="fare-leaderboard-page-heading fare-page-heading">
            <h1 className="fare-page-title is-long" id="leaderboard-page-title">LEADERBOARD</h1>
            <p>Verified owners ranked by current active fleet weight.</p>
          </div>

          <div className="fare-leaderboard fare-leaderboard-full">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>ACTIVE WEIGHT</span>
            </div>
            {leaders.map((leader, index) => (
              <div className={`fare-leaderboard-row${leader.owner === currentOwner ? ' is-current-driver' : ''}`} key={leader.owner} ref={leader.owner === currentOwner ? currentDriverRef : undefined}>
                <span>{index + 1}</span>
                <span className="fare-driver-cell"><a className="fare-driver-name" href={`https://solscan.io/account/${leader.owner}`} target="_blank" rel="noreferrer">{shortWallet(leader.owner)}{leader.owner === currentOwner && <strong className="fare-you-badge">YOU</strong>}</a></span>
                <span>{leader.cars} {leader.cars === 1 ? 'Car' : 'Cars'}</span>
                <span>{leader.activeWeight}</span>
              </div>
            ))}
            {notice && <div className="fare-leaderboard-row"><span>—</span><span>{notice}</span><span>—</span><span>—</span></div>}
          </div>
        </section>
      </main>

      <div className={`fare-current-driver-dock${dockHidden ? ' is-hidden' : ''}`} aria-hidden={dockHidden}>
        <span>{currentIndex + 1}</span>
        <span className="fare-driver-cell"><span className="fare-driver-name">{currentLeader ? shortWallet(currentLeader.owner) : '—'}<strong className="fare-you-badge">YOU</strong></span></span>
        <span>{currentLeader?.cars || 0} Cars</span>
        <span>{currentLeader?.activeWeight || 0}</span>
      </div>

    </>
  );
}

function shortWallet(wallet) {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
