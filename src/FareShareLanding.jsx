import { useEffect, useMemo, useRef, useState } from 'react';
import { createCity } from './city/createCity.js';
import { loadSettings } from './city/settings.js';
import { fleetColumnCount, fleetRoadPlaybackRate } from './fleetWall.js';
import { FareFaq } from './FareFaq.jsx';
import { RoadMarkStrip } from './RoadMarkStrip.jsx';
import drivingScenes from './drivingScenes.json';
import { displayTicker, useTokenConfig } from './tokenConfig.jsx';
import { loadPublicOverview } from './publicData.js';

const FLEET_ROAD_SPEED = 19;
const STATIC_DRIVING_SCENES = drivingScenes;
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
const PORSCHE_STEP_SCENE = STATIC_DRIVING_SCENES.find(scene => scene.name === 'Porsche 911') || {
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

export function FareShareCityBackground({ colorScheme = 'classic', followHero = true }) {
  const containerRef = useRef(null);
  const cityRef = useRef(null);
  const settingsRef = useRef(null);

  useEffect(() => {
    try {
      const settings = { ...loadSettings(), colorScheme };
      settingsRef.current = settings;
      cityRef.current = createCity(containerRef.current, settings);
    } catch (error) {
      console.error('Unable to start the Fare Share city background', error);
    }
    return () => {
      cityRef.current?.dispose();
      cityRef.current = null;
      settingsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cityRef.current || !settingsRef.current) return undefined;

    let currentColorScheme = settingsRef.current.colorScheme;
    const updateColorScheme = (nextColorScheme) => {
      if (nextColorScheme === currentColorScheme) return;
      currentColorScheme = nextColorScheme;
      settingsRef.current = { ...settingsRef.current, colorScheme: nextColorScheme };
      cityRef.current?.updateSettings(settingsRef.current);
    };

    updateColorScheme(colorScheme);
    if (!followHero) return undefined;

    const heroTitle = document.querySelector('#fare-hero-title');
    if (!heroTitle) return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      const titleIsAboveViewport = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
      updateColorScheme(titleIsAboveViewport ? 'pale' : 'classic');
    });
    observer.observe(heroTitle);
    return () => observer.disconnect();
  }, [colorScheme, followHero]);

  return (
    <div className="fare-city-background" style={{ opacity: 1, filter: 'none' }} aria-hidden="true">
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
  const imageUrl = scene.imageUrl;

  return (
    <div
      className="fare-fleet-scene-card"
      onClick={(event) => blinkSceneHeadlights(event.currentTarget, settings)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setIsHovered(true);
      }}
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
        '--road-travel-x': `${settings.markSpacing * pathX}cqw`,
        '--road-travel-y': `${settings.markSpacing * pathY}cqw`,
        '--road-cycle-duration': `${settings.markSpacing / Math.max(roadSpeed, .001)}s`,
        animationPlayState: roadSpeed > 0 ? undefined : 'paused',
      }}>
        <RoadMarkStrip className="fare-fleet-road-line" settings={settings} sizeUnit="cqw" />
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

export function FareStepDrivingScene({ scene = PORSCHE_STEP_SCENE, showHeadlights = true }) {
  const roadRef = useRef(null);
  const boundsRef = useRef(null);
  const rateFrameRef = useRef(0);
  const previousRateFrameRef = useRef(0);
  const targetRateRef = useRef(1);
  const settings = { ...FALLBACK_SCENE.settings, ...scene.settings };
  const radians = settings.pathAngle * Math.PI / 180;
  const pathX = Math.cos(radians);
  const pathY = Math.sin(radians);
  const roadSpeed = settings.markSpeed ?? FLEET_ROAD_SPEED;
  const imageUrl = scene.imageUrl;

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
      onClick={showHeadlights ? (event) => blinkSceneHeadlights(event.currentTarget, settings) : undefined}
      onPointerEnter={(event) => { boundsRef.current = event.currentTarget.getBoundingClientRect(); }}
      onPointerMove={updateRoadRateFromPointer}
      onPointerLeave={() => setTargetRoadRate(1)}
    >
      <img className="fare-step-driving-car" src={imageUrl} alt="" loading="lazy" decoding="async" />
      <div className="fare-fleet-road" ref={roadRef} style={{
        '--road-travel-x': `${settings.markSpacing * pathX}cqw`,
        '--road-travel-y': `${settings.markSpacing * pathY}cqw`,
        '--road-cycle-duration': `${settings.markSpacing / Math.max(roadSpeed, .001)}s`,
        animationPlayState: roadSpeed > 0 ? undefined : 'paused',
      }}>
        <RoadMarkStrip className="fare-fleet-road-line" settings={settings} sizeUnit="cqw" />
      </div>
      {showHeadlights && [
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
  const scenes = STATIC_DRIVING_SCENES;
  const [columnCount, setColumnCount] = useState(() => fleetColumnCount(window.innerWidth));
  const wallRef = useRef(null);
  const wallVisibleRef = useRef(false);
  const cardEntriesRef = useRef([]);
  const cardVisibilityObserverRef = useRef(null);
  const boundsMeasuredAtRef = useRef(0);
  const proximityFrameRef = useRef(0);
  const rateFrameRef = useRef(0);
  const previousRateFrameRef = useRef(0);

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
    cardEntriesRef.current.forEach(({ road }) => road?.getAnimations().forEach((animation) => animation.pause()));
    cardVisibilityObserverRef.current?.disconnect();
    cardEntriesRef.current.forEach(({ card }) => cardVisibilityObserverRef.current?.observe(card));
    boundsMeasuredAtRef.current = 0;
  };

  const refreshCardBounds = (now = performance.now()) => {
    for (const entry of cardEntriesRef.current) {
      entry.bounds = entry.card.classList.contains('is-road-active')
        ? entry.card.getBoundingClientRect()
        : null;
    }
    boundsMeasuredAtRef.current = now;
  };

  useEffect(collectCards, [visibleColumns]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cardEntriesRef.current.forEach(({ card, road }) => {
        card.classList.toggle('is-road-active', !reduceMotion);
        if (!reduceMotion) road?.getAnimations().forEach((animation) => animation.play());
      });
      return undefined;
    }

    cardVisibilityObserverRef.current = new IntersectionObserver((entries) => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      entries.forEach((entry) => {
        const isActive = entry.isIntersecting && !reduceMotion;
        entry.target.classList.toggle('is-road-active', isActive);
        entry.target.querySelector('.fare-fleet-road')?.getAnimations()
          .forEach((animation) => isActive ? animation.play() : animation.pause());
      });
    }, { rootMargin: '120px 0px' });
    collectCards();

    return () => {
      cardVisibilityObserverRef.current?.disconnect();
      cardVisibilityObserverRef.current = null;
    };
  }, []);

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
      if (!road?.dataset.targetPlaybackRate) continue;
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

  const handlePointerMove = (event) => {
    if (event.pointerType !== 'mouse') return;
    setRoadPlaybackRates(event.clientX, event.clientY);
  };

  const handlePointerEnter = (event) => {
    if (event.pointerType !== 'mouse') return;
    refreshCardBounds();
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType !== 'mouse') return;
    resetRoadPlaybackRates();
  };

  return (
    <div
      className="fare-fleet-card-wall is-paused"
      ref={wallRef}
      aria-hidden="true"
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div className="fare-fleet-wall-track">
        {[0, 1].map(copyIndex => <div className="fare-fleet-wall-grid" key={copyIndex}>
          {visibleColumns.map(({ columnIndex, cards }) => (
            <div className={`fare-fleet-card-column ${columnIndex % 2 ? 'is-down' : 'is-up'}`} key={`${copyIndex}-${columnIndex}`}>
              <div className="fare-fleet-card-track" style={{ '--column-duration': `${60 + columnIndex * 3.6}s`, '--column-delay': `${-columnIndex * 5.4}s` }}>
                {cards.map(({ scene, fleetClass }, cardIndex) => <FleetSceneCard scene={scene} fleetClass={fleetClass} key={`${scene.id}-${cardIndex}`} />)}
              </div>
            </div>
          ))}
          </div>
        )}
      </div>
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

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny it in this context.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

const HERO_TOKEN_MINT = '5BVBo9erzm3hzutnmc5nuitRVNVNb3GEiCfB8CmWpump';

export function FareShareLanding() {
  const token = useTokenConfig();
  const ticker = displayTicker(token);
  const caDisplay = `${HERO_TOKEN_MINT.slice(0, 6)}...${HERO_TOKEN_MINT.slice(-6)}`;
  const [caCopyState, setCaCopyState] = useState('idle');
  const [copyAnimationKey, setCopyAnimationKey] = useState(0);
  const copyResetTimerRef = useRef(null);
  const copyReturnTimerRef = useRef(null);
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    let active = true;
    loadPublicOverview().then(value => active && setOverview(value)).catch(error => console.error('Could not load public protocol data', error));
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(copyResetTimerRef.current);
    window.clearTimeout(copyReturnTimerRef.current);
  }, []);

  const handleCopyCa = async () => {
    try {
      await copyToClipboard(HERO_TOKEN_MINT);
      setCaCopyState('copied');
      setCopyAnimationKey(key => key + 1);
      window.clearTimeout(copyResetTimerRef.current);
      window.clearTimeout(copyReturnTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => {
        setCaCopyState('returning');
        copyReturnTimerRef.current = window.setTimeout(() => setCaCopyState('idle'), 250);
      }, 900);
    } catch (error) {
      console.error('Could not copy token CA', error);
    }
  };

  const steps = [
    {
      number: '1',
      title: 'GET A CAR',
      text: 'Start with a free trainee car, then build your real fleet.',
      sprite: '/fare-share/how-it-works/get-a-car-sprite.webp',
    },
    {
      number: '2',
      title: 'STAY ACTIVE',
      text: 'A newly minted taxi starts earning automatically while its durability remains active.',
      drivingScene: true,
    },
    {
      number: '3',
      title: 'CLAIM REWARDS',
      text: `Claim your calculated $${ticker}, UBERx, TSLAx, GOOGLx and AMZNx rewards.`,
      collectScene: true,
    },
  ];

  const treasuryStats = [
    { label: 'MINTED CARS', value: overview ? String(overview.stats.mintedCars) : '—', accent: true },
    { label: 'ACTIVE CARS', value: overview ? String(overview.stats.activeCars) : '—' },
    { label: 'UNIQUE OWNERS', value: overview ? String(overview.stats.uniqueOwners) : '—' },
    { label: 'ACTIVE WEIGHT', value: overview ? overview.stats.activeWeight : '—' },
    { label: 'TREASURY SOL', value: overview ? formatLandingSol(overview.stats.treasurySolLamports) : '—' },
    { label: 'FUNDED REWARD ASSETS', value: overview ? `${overview.stats.fundedRewardAssets}/5` : '—' },
  ];

  const leaders = overview?.leaders?.slice(0, 5) || [];

  return (
    <>
      <main id="top">
        <section className="fare-hero" aria-labelledby="fare-hero-title">
          <div className="container container--hero">
          <div className="fare-hero-copy">
            <h1 id="fare-hero-title"><span>OWN TAXIS.</span><span>EARN STOCK</span><span>TOKENS.</span></h1>
            <p className="fare-hero-intro">Mint onchain taxis that automatically share calculated protocol rewards while active.</p>
            <div className="fare-hero-actions">
              <a className="fare-button fare-button-primary" href="#taxis">Get Started <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span></a>
              <a className="fare-button fare-button-light" href="#how-it-works">How It Works</a>
              <button
                className={`fare-button fare-button-dark${caCopyState === 'copied' ? ' is-copied' : ''}${caCopyState === 'returning' ? ' is-returning' : ''}`}
                type="button"
                onClick={handleCopyCa}
                aria-label={caCopyState === 'copied' ? 'CA copied' : 'Copy CA'}
              >
                <span className="fare-token-symbol">${ticker}</span>
                <span>{caDisplay}</span>
                <span className="fare-copy-icon" key={copyAnimationKey} aria-hidden="true">
                  <span className="fare-copy-glyph" />
                  <svg className="fare-copy-check" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12.5L9.2 17.5L20 6.5" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
          </div>
        </section>

        <section className="fare-how" id="how-it-works" aria-labelledby="fare-how-title">
          <div className="container">
          <div className="fare-how-heading">
            <h2 id="fare-how-title">SIMPLE. FAIR. CLEAR.</h2>
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
          </div>
        </section>

        <section className="fare-fleet" id="taxis" aria-labelledby="fare-fleet-title">
          <FleetCardBackground />
          <div className="container fare-fleet-container">
          <div className="fare-fleet-heading">
            <h2 id="fare-fleet-title">FOUR CARS. ONE RULE.</h2>
            <p className="fare-hero-intro">Better classes receive a larger earning share. No twelve-stat RPG spreadsheet.</p>
          </div>

          <a className="fare-button fare-button-primary fare-fleet-button" href="/garage/">
            Explore The Fleet <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow /></span>
          </a>
          </div>
        </section>

        <section className="fare-treasury" id="dashboard" aria-labelledby="fare-treasury-title">
          <div className="container fare-treasury-container">
          <div className="fare-treasury-heading">
            <h2 id="fare-treasury-title">PARK TREASURY.</h2>
          </div>

          <p className="fare-treasury-intro">Own taxis, keep them active, and claim calculated {ticker} and xStock rewards.</p>

          <div className="fare-stat-grid">
            {treasuryStats.map(stat => <article className="fare-stat-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong className={stat.accent ? 'is-accent' : undefined}>{stat.value}</strong>
            </article>)}
          </div>

          <div className="fare-leaderboard-heading">
            <h3>LEADERBOARD</h3>
            <a className="fare-leaderboard-button" href="/leaderboard/">
              View Full Leaderboard
              <span className="fare-round-arrow fare-round-arrow-dark" aria-hidden="true"><GetStartedArrow color="#FFFFFF" /></span>
            </a>
          </div>

          <div className="fare-leaderboard" id="leaderboard">
            <div className="fare-leaderboard-row fare-leaderboard-header">
              <span>#</span><span>DRIVER</span><span>CARS OWNED</span><span>ACTIVE WEIGHT</span>
            </div>
            {leaders.map((leader, index) => <div className="fare-leaderboard-row" key={leader.owner}>
              <span data-label="#">{index + 1}</span>
              <span className="fare-driver-cell" data-label="WALLET"><a href={`https://solscan.io/account/${leader.owner}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textDecorationThickness: '1px', textUnderlineOffset: '3px' }}>{shortLandingWallet(leader.owner)}</a></span>
              <span data-label="CARS">{leader.cars} {leader.cars === 1 ? 'Car' : 'Cars'}</span>
              <span data-label="ACTIVE WEIGHT">{leader.activeWeight}</span>
            </div>)}
            {overview && leaders.length === 0 && <div className="fare-leaderboard-row"><span>—</span><span>No verified owners yet</span><span>0 Cars</span><span>0</span></div>}
          </div>
          </div>
        </section>

        <FareFaq />
      </main>
    </>
  );
}

function formatLandingSol(lamports) {
  const value = Number(lamports) / 1_000_000_000;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)} SOL`;
}

function shortLandingWallet(wallet) {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
