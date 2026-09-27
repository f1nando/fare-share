import { useEffect, useMemo, useRef, useState } from 'react';
import { createCity } from './city/createCity.js';
import { loadSettings } from './city/settings.js';
import { fleetColumnCount, fleetRoadPlaybackRate } from './fleetWall.js';
import { RoadMarkStrip } from './RoadMarkStrip.jsx';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787').replace(/\/$/, '');
const FLEET_ROAD_SPEED = 19;
const FLEET_CLASSES = {
  economy: { name: 'Economy', tone: 'economy' },
  comfort: { name: 'Comfort', tone: 'comfort' },
  business: { name: 'Business', tone: 'business' },
  legend: { name: 'Legendary', tone: 'legend' },
};
const FLEET_CLASS_BY_SCENE_NAME = new Map([
  ...['Checker Marathon', 'London Taxi', 'Chevrolet Caprice', 'Toyota Sienna'].map((name) => [name.toLowerCase(), FLEET_CLASSES.economy]),
  ...['Toyota Prius', 'Ford Crown Victoria', 'Toyota Camry', 'Mercedes E211'].map((name) => [name.toLowerCase(), FLEET_CLASSES.comfort]),
  ...['Tesla Model 3', 'Bentley Flying Spur', 'Mercedes G63', 'Rolls-Royce Cullinan'].map((name) => [name.toLowerCase(), FLEET_CLASSES.business]),
  ...['BMW M3 E46', 'Lamborghini Huracán', 'Bugatti Chiron', 'Porsche 911'].map((name) => [name.toLowerCase(), FLEET_CLASSES.legend]),
]);
const FALLBACK_SCENE = {
  id: 'local-bmw-m3-e46',
  name: 'BMW M3 E46',
  imageUrl: '/driving-demo/bmw-m3-e46.webp',
  settings: {
    markSpacing: 37,
    pathAngle: -135,
    markX: 50,
    markY: 84,
    markWidth: 17,
    markAngleOffset: 0,
    markOpacity: 100,
    backgroundHue: 0,
    backgroundSaturation: 100,
    backgroundGrayscale: 0,
    leftX: 65,
    leftY: 59,
    rightX: 83,
    rightY: 60,
    blinkSize: 12,
    blinkOpacity: 100,
  },
};
const PORSCHE_STEP_SCENE = {
  imageUrl: '/fare-share/how-it-works/porsche-911.webp',
  settings: {
    markSpacing: 34.5,
    pathAngle: -169,
    markX: 50,
    markY: 81,
    markWidth: 29.5,
    markAngleOffset: 167.5,
  },
};

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function FareShareCityBackground() {
  const containerRef = useRef(null);

  useEffect(() => {
    let city;
    let observer;
    try {
      const settings = { ...loadSettings(), colorScheme: 'classic' };
      let colorScheme = settings.colorScheme;
      city = createCity(containerRef.current, settings);

      const secondSection = document.querySelector('.fare-how');
      if (secondSection) {
        observer = new IntersectionObserver(([entry]) => {
          const nextColorScheme = entry.isIntersecting || entry.boundingClientRect.top < 0 ? 'pale' : 'classic';
          if (nextColorScheme === colorScheme) return;
          colorScheme = nextColorScheme;
          city?.updateSettings({ ...settings, colorScheme });
        });
        observer.observe(secondSection);
      }
    } catch (error) {
      console.error('Unable to start the Fare Share city background', error);
    }
    return () => {
      observer?.disconnect();
      city?.dispose();
    };
  }, []);

  return (
    <div className="fare-city-background" aria-hidden="true">
      <div className="fare-city-canvas" ref={containerRef} />
    </div>
  );
}

function getFleetClass(scene) {
  return FLEET_CLASS_BY_SCENE_NAME.get(String(scene.name || '').trim().toLowerCase()) || FLEET_CLASSES.economy;
}

function createSceneSequence(scenes, count) {
  if (scenes.length < 2) return Array.from({ length: count }, () => scenes[0]);
  const sequence = [];
  for (let index = 0; index < count; index += 1) {
    const previousId = sequence[index - 1]?.id;
    const firstId = index === count - 1 ? sequence[0]?.id : undefined;
    const candidates = scenes.filter((scene) => scene.id !== previousId && scene.id !== firstId);
    sequence.push(randomItem(candidates.length ? candidates : scenes.filter((scene) => scene.id !== previousId)));
  }
  return sequence;
}

function blinkSceneHeadlights(container, settings) {
  container.querySelectorAll('.fare-fleet-headlight').forEach((light) => {
    light.getAnimations().forEach((animation) => animation.cancel());
    light.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.4)' },
      { opacity: settings.blinkOpacity / 100, transform: 'translate(-50%, -50%) scale(1)', offset: .24 },
      { opacity: settings.blinkOpacity / 100, transform: 'translate(-50%, -50%) scale(1)', offset: .54 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.4)' },
    ], { duration: 620, easing: 'ease-out' });
  });
}

function FleetSceneCard({ scene, fleetClass }) {
  const [isHovered, setIsHovered] = useState(false);
  const settings = { ...FALLBACK_SCENE.settings, ...scene.settings };
  const radians = settings.pathAngle * Math.PI / 180;
  const pathX = Math.cos(radians);
  const pathY = Math.sin(radians);
  const roadSpeed = settings.markSpeed ?? FLEET_ROAD_SPEED;
  const imageUrl = scene.imageUrl.startsWith('/api/') ? `${API_BASE}${scene.imageUrl}` : scene.imageUrl;

  return (
    <div
      className="fare-fleet-scene-card"
      onClick={(event) => blinkSceneHeadlights(event.currentTarget, settings)}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onDragStart={(event) => event.preventDefault()}
    >
      <span className={`fare-fleet-class is-${fleetClass.tone}`}>{fleetClass.name}</span>
      <img
        className="fare-fleet-car"
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div className="fare-fleet-road" style={{
        '--road-travel-x': `${settings.markSpacing * pathX}%`,
        '--road-travel-y': `${settings.markSpacing * pathY}%`,
        '--road-cycle-duration': `${settings.markSpacing / Math.max(roadSpeed, .001)}s`,
        animationPlayState: roadSpeed > 0 ? undefined : 'paused',
      }}>
        <RoadMarkStrip className="fare-fleet-road-line" settings={settings} />
      </div>
      {isHovered && [
        ['left', settings.leftX, settings.leftY],
        ['right', settings.rightX, settings.rightY],
      ].map(([name, x, y]) => (
        <img
          className={`fare-fleet-headlight fare-fleet-headlight-${name}`}
          src="/driving-demo/blink.webp"
          alt=""
          key={name}
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: `${settings.blinkSize}%`,
          }}
        />
      ))}
    </div>
  );
}

function FareStepDrivingScene() {
  const [scene, setScene] = useState(PORSCHE_STEP_SCENE);
  const roadRef = useRef(null);
  const boundsRef = useRef(null);
  const rateFrameRef = useRef(0);
  const previousRateFrameRef = useRef(0);
  const targetRateRef = useRef(1);
  const settings = { ...FALLBACK_SCENE.settings, ...PORSCHE_STEP_SCENE.settings, ...scene.settings };
  const radians = settings.pathAngle * Math.PI / 180;
  const pathX = Math.cos(radians);
  const pathY = Math.sin(radians);
  const roadSpeed = settings.markSpeed ?? FLEET_ROAD_SPEED;
  const imageUrl = scene.imageUrl.startsWith('/api/') ? `${API_BASE}${scene.imageUrl}` : scene.imageUrl;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/driving-scenes`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Scene library unavailable')))
      .then((body) => {
        const porsche = body.scenes?.find((item) => String(item.name).trim().toLowerCase() === 'porsche 911');
        if (porsche) setScene(porsche);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const animateRoadRate = (now) => {
    rateFrameRef.current = 0;
    const road = roadRef.current;
    if (!road) return;
    const animations = road.getAnimations();
    if (!animations.length) return;
    const previous = previousRateFrameRef.current || now - 16;
    const elapsed = Math.min((now - previous) / 1000, .05);
    const easing = 1 - Math.exp(-elapsed * 2.8);
    const currentRate = Number(road.dataset.currentPlaybackRate || animations[0].playbackRate || 1);
    const difference = targetRateRef.current - currentRate;
    const nextRate = Math.abs(difference) < .01 ? targetRateRef.current : currentRate + difference * easing;
    road.dataset.currentPlaybackRate = String(nextRate);
    animations.forEach((animation) => { animation.playbackRate = nextRate; });
    previousRateFrameRef.current = now;
    if (Math.abs(targetRateRef.current - nextRate) >= .01) {
      rateFrameRef.current = requestAnimationFrame(animateRoadRate);
    } else previousRateFrameRef.current = 0;
  };

  const setTargetRoadRate = (playbackRate) => {
    targetRateRef.current = playbackRate;
    if (!rateFrameRef.current) {
      previousRateFrameRef.current = 0;
      rateFrameRef.current = requestAnimationFrame(animateRoadRate);
    }
  };

  const updateRoadRateFromPointer = (event) => {
    if (!boundsRef.current) boundsRef.current = event.currentTarget.getBoundingClientRect();
    setTargetRoadRate(fleetRoadPlaybackRate(boundsRef.current, event.clientX, event.clientY));
  };

  useEffect(() => {
    const invalidateBounds = () => { boundsRef.current = null; };
    window.addEventListener('resize', invalidateBounds);
    window.addEventListener('scroll', invalidateBounds, { passive: true });
    return () => {
      window.removeEventListener('resize', invalidateBounds);
      window.removeEventListener('scroll', invalidateBounds);
      cancelAnimationFrame(rateFrameRef.current);
    };
  }, []);

  return (
    <div
      className="fare-step-media fare-step-driving"
      aria-hidden="true"
      onClick={(event) => blinkSceneHeadlights(event.currentTarget, settings)}
      onPointerEnter={(event) => { boundsRef.current = event.currentTarget.getBoundingClientRect(); }}
      onPointerMove={updateRoadRateFromPointer}
      onPointerLeave={() => setTargetRoadRate(1)}
    >
      <img className="fare-step-driving-car" src={imageUrl} alt="" loading="lazy" decoding="async" />
      <div className="fare-fleet-road" ref={roadRef} style={{
        '--road-travel-x': `${settings.markSpacing * pathX}%`,
        '--road-travel-y': `${settings.markSpacing * pathY}%`,
        '--road-cycle-duration': `${settings.markSpacing / Math.max(roadSpeed, .001)}s`,
        animationPlayState: roadSpeed > 0 ? undefined : 'paused',
      }}>
        <RoadMarkStrip className="fare-fleet-road-line" settings={settings} />
      </div>
      {[
        ['left', settings.leftX, settings.leftY],
        ['right', settings.rightX, settings.rightY],
      ].map(([name, x, y]) => (
        <img
          className={`fare-fleet-headlight fare-fleet-headlight-${name}`}
          src="/driving-demo/blink.webp"
          alt=""
          key={name}
          style={{ left: `${x}%`, top: `${y}%`, width: `${settings.blinkSize}%` }}
        />
      ))}
    </div>
  );
}

function FareStepCollectScene() {
  const assetPath = '/fare-share/how-it-works/collect-wallet';

  return (
    <div className="fare-step-media fare-step-collect" aria-hidden="true">
      <img className="fare-collect-wallet fare-collect-wallet-back" src={`${assetPath}/wallet-back.webp`} alt="" loading="lazy" decoding="async" />
      <div className="fare-collect-flying-assets">
        <span className="fare-collect-asset fare-collect-card fare-collect-card-one"><img src={`${assetPath}/stock-card.webp`} alt="" loading="lazy" decoding="async" /></span>
        <span className="fare-collect-asset fare-collect-card fare-collect-card-two"><img src={`${assetPath}/stock-card.webp`} alt="" loading="lazy" decoding="async" /></span>
        <span className="fare-collect-asset fare-collect-coin fare-collect-coin-one"><img src={`${assetPath}/coin-1.webp`} alt="" loading="lazy" decoding="async" /></span>
        <span className="fare-collect-asset fare-collect-coin fare-collect-coin-two"><img src={`${assetPath}/coin-2.webp`} alt="" loading="lazy" decoding="async" /></span>
        <span className="fare-collect-asset fare-collect-coin fare-collect-coin-three"><img src={`${assetPath}/coin-3.webp`} alt="" loading="lazy" decoding="async" /></span>
      </div>
      <div className="fare-collect-depth-mask" />
      <img className="fare-collect-wallet fare-collect-wallet-front" src={`${assetPath}/wallet-front.webp`} alt="" loading="lazy" decoding="async" />
    </div>
  );
}

function FleetCardBackground() {
  const [scenes, setScenes] = useState([FALLBACK_SCENE]);
  const [columnCount, setColumnCount] = useState(() => fleetColumnCount(window.innerWidth));
  const wallRef = useRef(null);
  const wallVisibleRef = useRef(false);
  const cardEntriesRef = useRef([]);
  const boundsMeasuredAtRef = useRef(0);
  const proximityFrameRef = useRef(0);
  const rateFrameRef = useRef(0);
  const previousRateFrameRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/driving-scenes`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Scene library unavailable')))
      .then((body) => {
        if (body.scenes?.length) setScenes(body.scenes);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const classesByScene = useMemo(() => new Map(
    scenes.map((scene) => [scene.id, getFleetClass(scene)]),
  ), [scenes]);

  const columns = useMemo(() => Array.from({ length: 7 }, (_, columnIndex) => {
    const cards = createSceneSequence(scenes, 6).map((scene) => ({
      scene,
      fleetClass: classesByScene.get(scene.id),
    }));
    return { columnIndex, cards: [...cards, ...cards] };
  }), [classesByScene, scenes]);
  const visibleColumns = useMemo(() => columns.slice(0, columnCount), [columnCount, columns]);

  const collectCards = () => {
    cardEntriesRef.current = [...(wallRef.current?.querySelectorAll('.fare-fleet-scene-card') ?? [])].map(card => ({
      card,
      road: card.querySelector('.fare-fleet-road'),
      bounds: null,
    }));
    boundsMeasuredAtRef.current = 0;
  };

  const refreshCardBounds = (now = performance.now()) => {
    for (const entry of cardEntriesRef.current) entry.bounds = entry.card.getBoundingClientRect();
    boundsMeasuredAtRef.current = now;
  };

  useEffect(collectCards, [visibleColumns]);

  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setColumnCount(fleetColumnCount(window.innerWidth)));
    };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const wall = wallRef.current;
    const section = wall?.closest('.fare-fleet');
    const observer = new IntersectionObserver(([entry]) => {
      wallVisibleRef.current = entry.isIntersecting;
      wall?.classList.toggle('is-paused', !entry.isIntersecting);
      if (!entry.isIntersecting) {
        cancelAnimationFrame(proximityFrameRef.current);
        cancelAnimationFrame(rateFrameRef.current);
        proximityFrameRef.current = 0;
        rateFrameRef.current = 0;
      } else collectCards();
    });
    if (section) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(proximityFrameRef.current);
    cancelAnimationFrame(rateFrameRef.current);
  }, []);

  const animateRoadPlaybackRates = (now) => {
    rateFrameRef.current = 0;
    const previous = previousRateFrameRef.current || now - 16;
    const elapsed = Math.min((now - previous) / 1000, .05);
    const easing = 1 - Math.exp(-elapsed * 2.8);
    let needsAnotherFrame = false;

    for (const { road } of cardEntriesRef.current) {
      if (!road) continue;
      const targetRate = Number(road.dataset.targetPlaybackRate || 1);
      const animations = road.getAnimations();
      if (!animations.length) continue;
      const currentRate = Number(road.dataset.currentPlaybackRate || animations[0].playbackRate || 1);
      const difference = targetRate - currentRate;
      const nextRate = Math.abs(difference) < .01 ? targetRate : currentRate + difference * easing;
      road.dataset.currentPlaybackRate = String(nextRate);
      animations.forEach((animation) => { animation.playbackRate = nextRate; });
      if (Math.abs(targetRate - nextRate) >= .01) needsAnotherFrame = true;
    }

    previousRateFrameRef.current = now;
    if (needsAnotherFrame) rateFrameRef.current = requestAnimationFrame(animateRoadPlaybackRates);
    else previousRateFrameRef.current = 0;
  };

  const startRoadRateTransition = () => {
    if (!rateFrameRef.current) {
      previousRateFrameRef.current = 0;
      rateFrameRef.current = requestAnimationFrame(animateRoadPlaybackRates);
    }
  };

  const setRoadPlaybackRates = (clientX, clientY) => {
    if (!wallVisibleRef.current) return;
    cancelAnimationFrame(proximityFrameRef.current);
    proximityFrameRef.current = requestAnimationFrame(() => {
      const now = performance.now();
      if (now - boundsMeasuredAtRef.current > 500) refreshCardBounds(now);
      for (const { bounds, road } of cardEntriesRef.current) {
        if (!bounds) continue;
        if (road) road.dataset.targetPlaybackRate = String(fleetRoadPlaybackRate(bounds, clientX, clientY));
      }
      startRoadRateTransition();
    });
  };

  const resetRoadPlaybackRates = () => {
    cancelAnimationFrame(proximityFrameRef.current);
    for (const { road } of cardEntriesRef.current) if (road) {
      road.dataset.targetPlaybackRate = '1';
    }
    startRoadRateTransition();
  };

  return (
    <div
      className="fare-fleet-card-wall is-paused"
      ref={wallRef}
      aria-hidden="true"
      onPointerMove={(event) => setRoadPlaybackRates(event.clientX, event.clientY)}
      onPointerEnter={() => refreshCardBounds()}
      onPointerLeave={resetRoadPlaybackRates}
    >
      {visibleColumns.map(({ columnIndex, cards }) => (
        <div className={`fare-fleet-card-column ${columnIndex % 2 ? 'is-down' : 'is-up'}`} key={columnIndex}>
          <div className="fare-fleet-card-track" style={{ '--column-duration': `${60 + columnIndex * 3.6}s`, '--column-delay': `${-columnIndex * 5.4}s` }}>
            {cards.map(({ scene, fleetClass }, cardIndex) => <FleetSceneCard scene={scene} fleetClass={fleetClass} key={`${scene.id}-${cardIndex}`} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function GetStartedArrow({ color = '#FFE72F' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.7071 15V1H0.707092M14.7071 1L0.707092 15" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="24" height="22" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18.9 0H22.581L14.541 9.3189L24 22H16.5945L10.794 14.3076L4.1565 22H0.474L9.0735 12.0317L0 0H7.5945L12.837 7.02938L18.9 0ZM17.61 19.7666H19.65L6.4845 2.11655H4.2975L17.61 19.7666Z" fill="#101010" />
    </svg>
  );
}

function FaqChevron() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="44" height="44" rx="22" fill="black" />
      <path d="M14 19L22 27L30 19" stroke="white" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function FareShareLanding() {
  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  const steps = [
    {
      number: '1',
      title: 'GET A CAR',
      text: 'Start with a free trainee car, then build your real fleet.',
      sprite: '/fare-share/how-it-works/get-a-car-sprite.webp',
    },
    {
      number: '2',
      title: 'RUN A SHIFT',
      text: 'Send ready cars to work with one clear action.',
      drivingScene: true,
    },
    {
      number: '3',
      title: 'COLLECT',
      text: 'Receive daily revenue in cash and your selected stock.',
      collectScene: true,
    },
  ];

  const treasuryStats = [
    { label: 'TRADING / 24H', value: '$482,918', accent: true },
    { label: 'FEES COLLECTED', value: '$18,482' },
    { label: 'IN TREASURY', value: '$84,218' },
    { label: 'PAID TODAY', value: '$12,204' },
    { label: 'TOKENS BURNED', value: '1.82M' },
    { label: 'STOCKS PURCHASED', value: '$9,241' },
  ];

  const leaders = [
    ['1', '24 430$'],
    ['2', '16 842$'],
    ['3', '24 430$'],
    ['4', '16 842$'],
    ['5', '24 430$'],
  ];

  const faqItems = [
    {
      question: 'HOW DO IT EARN FROM MY CARS?',
      answer: 'Send ready cars on shift. Each completed shift pays park revenue in cash and your selected stock token.',
    },
    {
      question: 'WHAT ARE THE FEES?',
      answer: 'Fees cover fleet operations and servicing. Every charge is shown before you confirm an action.',
    },
    {
      question: 'CAN I SELL MY CARS?',
      answer: 'Yes. Eligible cars can be listed on the marketplace or transferred from your garage.',
    },
    {
      question: 'IS THIS A REAL PRODUCT?',
      answer: 'Yes. Fare Share combines collectible taxi ownership with transparent fleet revenue tracking.',
    },
    {
      question: 'WHERE CAN I READ THE FULL DOCS',
      answer: 'Open the Docs from the navigation for mechanics, fees, treasury rules, and contract details.',
    },
  ];

  return (
    <div className="fare-page">
      <FareShareCityBackground />
      <header className="fare-header">
        <a className="fare-brand" href="#top" aria-label="Fare Share home">
          <img src="/brand/fare-driver.webp" alt="" decoding="async" />
          <strong>FARE SHARE</strong>
          <span>$TAXI</span>
        </a>

        <nav className="fare-nav" aria-label="Main navigation">
          <a className="is-active" href="#top">HOME</a>
          <a href="#dashboard">DASHBOARD</a>
          <a href="#taxis">MINT</a>
          <a href="#garage">GARAGE</a>
          <a href="#market">MARKET</a>
          <a href="#trade">TRADE</a>
          <a href="#faq">FAQ</a>
          <a href="#docs">DOCS</a>
        </nav>

        <div className="fare-header-actions">
          <a className="fare-social" href="https://x.com" target="_blank" rel="noreferrer" aria-label="Fare Share on X">
            <XIcon />
          </a>
          <button className="fare-connect" type="button">
            Connect Wallet
            <svg className="fare-wallet-icon" width="28" height="26" viewBox="0 0 28 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M24 0H2.66667C1.95942 0 1.28115 0.280951 0.781048 0.781048C0.280951 1.28115 0 1.95942 0 2.66667V18.6667C0 19.3739 0.280951 20.0522 0.781048 20.5523C1.28115 21.0524 1.95942 21.3333 2.66667 21.3333H14.7867C14.7061 20.8935 14.6659 20.4472 14.6667 20C14.6667 17.8783 15.5095 15.8434 17.0098 14.3431C18.5101 12.8429 20.5449 12 22.6667 12C24.0726 11.9961 25.4538 12.369 26.6667 13.08V2.66667C26.6667 1.95942 26.3857 1.28115 25.8856 0.781048C25.3855 0.280951 24.7072 0 24 0ZM24 9.33333H2.66667V5.33333H24M24 14.6667V18.6667H28V21.3333H24V25.3333H21.3333V21.3333H17.3333V18.6667H21.3333V14.6667H24Z" fill="black" />
            </svg>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="fare-hero" aria-labelledby="fare-hero-title">
          <div className="fare-hero-copy">
            <h1 id="fare-hero-title"><span>OWN TAXIS.</span><span>EARN STOCK</span><span>TOKENS.</span></h1>
            <p className="fare-hero-intro">Put your taxis to work and collect park fees in stock tokens.</p>
            <div className="fare-hero-actions">
              <a className="fare-button fare-button-primary" href="#taxis">Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span></a>
              <a className="fare-button fare-button-light" href="#how-it-works">How It Works</a>
              <a className="fare-button fare-button-dark" href="#token">
                <span className="fare-token-symbol">$TAXI</span>
                <span>0x7d91...af4f2</span>
                <span className="fare-copy-icon" aria-hidden="true" />
                <span className="fare-round-arrow fare-round-arrow-light" aria-hidden="true"><GetStartedArrow color="#101010" /></span>
              </a>
            </div>
          </div>
        </section>

        <section className="fare-how" id="how-it-works" aria-labelledby="fare-how-title">
          <div className="fare-how-heading">
            <h2 id="fare-how-title">SIMPLE. FAIR. CLEAR.</h2>
            <p>Get a car, run one shift, collect revenue, service it<br />when needed.</p>
          </div>

          <div className="fare-step-grid">
            {steps.map(step => <article className="fare-step-card" key={step.number}>
              <span className="fare-step-number" aria-hidden="true">{step.number}</span>
              {step.sprite
                ? <div
                    className="fare-step-media fare-step-sprite"
                    style={{ backgroundImage: `url(${step.sprite})` }}
                    onPointerEnter={(event) => event.currentTarget.getAnimations().forEach((animation) => { animation.playbackRate = .4; })}
                    onPointerLeave={(event) => event.currentTarget.getAnimations().forEach((animation) => { animation.playbackRate = 1; })}
                    aria-hidden="true"
                  />
                : step.drivingScene
                  ? <FareStepDrivingScene />
                : step.collectScene
                  ? <FareStepCollectScene />
                  : null}
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>)}
          </div>

          <a className="fare-button fare-button-primary fare-how-button" href="#taxis">
            Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span>
          </a>
        </section>

        <section className="fare-fleet" id="taxis" aria-labelledby="fare-fleet-title">
          <FleetCardBackground />
          <div className="fare-fleet-heading">
            <h2 id="fare-fleet-title">FOUR CARS. ONE RULE.</h2>
            <p>Better classes receive a larger earning share. No twelve-stat<br />RPG spreadsheet.</p>
          </div>

          <a className="fare-button fare-button-primary fare-fleet-button" href="#garage">
            Explore The Fleet <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span>
          </a>
        </section>

        <section className="fare-treasury" id="dashboard" aria-labelledby="fare-treasury-title">
          <div className="fare-treasury-heading">
            <h2 id="fare-treasury-title">PARK TREASURY.</h2>
            <p>The trust page: trading, collected fees, treasury, payouts, token<br />burns and stock inventory.</p>
          </div>

          <p className="fare-treasury-intro">Own taxi cars, send them on shift, and collect park revenue in cash and stocks.</p>

          <div className="fare-stat-grid">
            {treasuryStats.map(stat => <article className="fare-stat-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong className={stat.accent ? 'is-accent' : undefined}>{stat.value}</strong>
            </article>)}
          </div>

          <div className="fare-leaderboard-heading">
            <h3>LEADERBOARD</h3>
            <a className="fare-leaderboard-button" href="#leaderboard">
              View Full Leaderboard
              <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow color="#FFFFFF" /></span>
            </a>
          </div>

          <div className="fare-leaderboard" id="leaderboard">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>TOTAL EARNINGS</span>
            </div>
            {leaders.map(([position, earnings]) => <div className="fare-leaderboard-row" key={position}>
              <span>{position}</span>
              <span className="fare-driver-cell"><img src="/brand/fare-driver.webp" alt="" loading="lazy" decoding="async" />User_4312234</span>
              <span>12 Cars</span>
              <span>{earnings}</span>
            </div>)}
          </div>
        </section>

        <section className="fare-faq" id="faq" aria-labelledby="fare-faq-title">
          <h2 id="fare-faq-title">FAQ</h2>
          <div className="fare-faq-list">
            {faqItems.map((item, index) => {
              const isOpen = openFaqIndex === index;
              const answerId = `fare-faq-answer-${index}`;

              return <article className={`fare-faq-entry${isOpen ? ' is-open' : ''}`} key={item.question}>
                <button
                  className="fare-faq-item"
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={answerId}
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                >
                  <span>{item.question}</span>
                  <FaqChevron />
                </button>
                <div className="fare-faq-answer" id={answerId} aria-hidden={!isOpen}>
                  <div><p>{item.answer}</p></div>
                </div>
              </article>;
            })}
          </div>
        </section>
      </main>

      <footer className="fare-footer">
        <div className="fare-footer-watermark" aria-hidden="true">FARE SHARE</div>
        <div className="fare-footer-inner">
          <div className="fare-footer-about">
            <div className="fare-footer-brand">
              <img src="/brand/fare-driver.webp" alt="" loading="lazy" decoding="async" />
              <strong>FARE SHARE</strong>
              <span>$NFT</span>
            </div>
            <p className="fare-footer-tagline">Own cars. Run shifts. Earn stock tokens.</p>
            <p className="fare-footer-copy">Build your taxi fleet, send cars on shift, and collect park fees in<br />cash and tokenized stocks.</p>
            <a className="fare-footer-social" href="https://x.com" target="_blank" rel="noreferrer" aria-label="Fare Share on X"><XIcon /></a>
            <p className="fare-footer-copyright">© 2026 Fare Share. All rights reserved.</p>
          </div>

          <nav className="fare-footer-column" aria-label="Footer navigation">
            <h2>NAVIGATION</h2>
            <a href="#top">Home</a>
            <a href="#taxis">Fleet</a>
            <a href="#garage">Garage</a>
            <a href="#shift">Shift</a>
          </nav>

          <nav className="fare-footer-column" aria-label="Resources">
            <h2>RESOURCES</h2>
            <a href="#how-it-works">How it Works</a>
            <a href="#dashboard">Treasury</a>
            <a href="#docs">Docs</a>
            <a href="#faq">FAQ</a>
          </nav>

          <nav className="fare-footer-column" aria-label="Legal">
            <h2>LEGAL</h2>
            <a href="#terms">Terms</a>
            <a href="#privacy">Privacy</a>
            <a href="#disclaimer">Disclaimer</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
