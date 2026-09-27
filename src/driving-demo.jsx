import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './driving-demo.css';

const DEFAULTS = {
  markSpeed: 19,
  markSpacing: 37,
  pathAngle: -135,
  markX: 50,
  markY: 84,
  markWidth: 17,
  markAngle: 0,
  markOpacity: 100,
  leftX: 65,
  leftY: 59,
  rightX: 83,
  rightY: 60,
  blinkSize: 12,
  blinkSpeed: 1,
  blinkOpacity: 100,
  doublePulseDuration: 180,
  doublePulseGap: 160,
  doubleSecondOpacity: 100,
  backgroundHue: 0,
  backgroundSaturation: 100,
  backgroundGrayscale: 0,
  carBlackness: 0,
};
const STORAGE_KEY = 'taxi-driving-demo-settings-v1';
const M3_REFERENCE_KEY = 'taxi-driving-demo-m3-reference-v1';
const SETTINGS_VERSION = 2;
const SOURCE_IMAGE_SIZE = 1254;
const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787').replace(/\/$/, '');
const DIRECTION_PRESETS = [
  { angle: -135, label: '↖', title: 'Вверх-влево', column: 1, row: 1 },
  { angle: -90, label: '↑', title: 'Вверх', column: 2, row: 1 },
  { angle: -45, label: '↗', title: 'Вверх-вправо', column: 3, row: 1 },
  { angle: -180, label: '←', title: 'Влево', column: 1, row: 2 },
  { angle: 0, label: '→', title: 'Вправо', column: 3, row: 2 },
  { angle: 135, label: '↙', title: 'Вниз-влево', column: 1, row: 3 },
  { angle: 90, label: '↓', title: 'Вниз', column: 2, row: 3 },
  { angle: 45, label: '↘', title: 'Вниз-вправо', column: 3, row: 3 },
];

function normalizeAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function createBlackCarLayer(source) {
  const layer = new ImageData(source.width, source.height);
  for (let index = 0; index < source.data.length; index += 4) {
    const red = source.data[index];
    const green = source.data[index + 1];
    const blue = source.data[index + 2];
    const alpha = source.data[index + 3];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    if (!delta || !alpha) continue;

    let hue;
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
    if (hue < 0) hue += 360;
    const saturation = delta / max;
    const hueWeight = Math.max(0, Math.min(1, Math.min((hue - 15) / 15, (78 - hue) / 15)));
    const saturationWeight = Math.max(0, Math.min(1, (saturation - .18) / .32));
    const mask = hueWeight * saturationWeight;
    if (mask <= 0) continue;

    const luminance = red * .2126 + green * .7152 + blue * .0722;
    const shade = Math.max(6, Math.min(62, 7 + luminance * .22));
    layer.data[index] = shade * .86;
    layer.data[index + 1] = shade * .92;
    layer.data[index + 2] = shade;
    layer.data[index + 3] = alpha * mask;
  }
  return layer;
}

function drawCar(canvas, image, blackLayer, blackness) {
  if (!canvas || !image || !blackLayer) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 1;
  context.drawImage(image, 0, 0);
  context.globalAlpha = blackness / 100;
  context.drawImage(blackLayer, 0, 0);
  context.globalAlpha = 1;
}

function loadStoredState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== 'object') throw new Error('Empty settings');
    const source = { ...stored.settings };
    if (!Number.isFinite(source.markSpacing) && Number.isFinite(source.markGap)) {
      source.markSpacing = source.markGap + (Number.isFinite(source.markWidth) ? source.markWidth : 210);
    }
    if (source.direction === -1 && Number.isFinite(source.pathAngle)) {
      source.pathAngle = normalizeAngle(source.pathAngle + 180);
    }
    if (stored.version !== SETTINGS_VERSION) {
      const pixelsToPercent = (value) => Math.round(value / SOURCE_IMAGE_SIZE * 10000) / 100;
      for (const key of ['markSpeed', 'markSpacing', 'markWidth']) {
        if (Number.isFinite(source[key])) source[key] = pixelsToPercent(source[key]);
      }
    }
    const settings = Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, fallback]) => [
        key,
        Number.isFinite(source[key]) ? source[key] : fallback,
      ]),
    );
    return { settings, lightsOn: stored.lightsOn === true };
  } catch {
    return { settings: DEFAULTS, lightsOn: false };
  }
}

function loadM3Reference(fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(M3_REFERENCE_KEY));
    if (!stored?.settings) throw new Error('Empty reference');
    return {
      settings: Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [
        key,
        Number.isFinite(stored.settings[key]) ? stored.settings[key] : value,
      ])),
      lightsOn: stored.lightsOn === true,
    };
  } catch {
    const reference = { settings: { ...fallback.settings }, lightsOn: fallback.lightsOn };
    localStorage.setItem(M3_REFERENCE_KEY, JSON.stringify(reference));
    return reference;
  }
}

function Range({ label, value, min, max, step = 1, unit = '', onChange }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="demo-range">
      <span>{label}<output>{value}{unit}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function FinePositionButtons({ value, onChange }) {
  const adjust = (delta) => onChange(Math.max(0, Math.min(100, Math.round((value + delta) * 10) / 10)));
  return (
    <div className="position-stepper">
      <button type="button" onClick={() => adjust(-0.1)}>−0.1</button>
      <button type="button" onClick={() => adjust(0.1)}>+0.1</button>
    </div>
  );
}

function DrivingDemo() {
  const [initialState] = useState(loadStoredState);
  const [m3Reference, setM3Reference] = useState(() => loadM3Reference(initialState));
  const [settings, setSettings] = useState(initialState.settings);
  const [paused, setPaused] = useState(false);
  const [lightsOn, setLightsOn] = useState(initialState.lightsOn);
  const [scenes, setScenes] = useState([]);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [sceneName, setSceneName] = useState('Локальное демо');
  const [sceneStatus, setSceneStatus] = useState('');
  const marksRef = useRef(null);
  const headlightRefs = useRef([]);
  const carCanvasRef = useRef(null);
  const carImageRef = useRef(null);
  const blackCarLayerRef = useRef(null);
  const blacknessRef = useRef(settings.carBlackness);
  const offsetRef = useRef(0);
  const targetSpeedRef = useRef(settings.markSpeed);
  const currentSpeedRef = useRef(settings.markSpeed);
  targetSpeedRef.current = settings.markSpeed;
  blacknessRef.current = settings.carBlackness;
  const update = (key) => (value) => setSettings((current) => ({ ...current, [key]: value }));
  const activeScene = scenes.find((scene) => scene.id === activeSceneId);
  const sceneImageUrl = activeScene ? `${API_BASE}${activeScene.imageUrl}` : '/driving-demo/m3.png';

  const selectScene = (scene) => {
    setActiveSceneId(scene?.id || '');
    setSceneName(scene?.name || 'Локальное демо');
    if (scene) {
      setSettings({ ...DEFAULTS, ...scene.settings });
      setLightsOn(scene.lightsOn === true);
      offsetRef.current = 0;
    }
  };

  const request = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  };

  const refreshScenes = async (preferredId) => {
    try {
      const body = await request('/api/driving-scenes');
      setScenes(body.scenes);
      const selected = body.scenes.find((scene) => scene.id === (preferredId || activeSceneId)) || body.scenes[0];
      if (selected) selectScene(selected);
      setSceneStatus(body.scenes.length ? '' : 'В базе пока нет сцен. Загрузите первую картинку.');
    } catch (error) {
      setSceneStatus(`Backend недоступен: ${error.message}`);
    }
  };

  useEffect(() => { refreshScenes(); }, []);

  const saveScene = async () => {
    if (!activeSceneId) { setSceneStatus('Сначала загрузите и выберите сцену.'); return; }
    setSceneStatus('Сохраняю…');
    try {
      const body = await request(`/api/driving-scenes/${activeSceneId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: sceneName, settings, lightsOn }),
      });
      setScenes((current) => current.map((scene) => scene.id === body.scene.id ? body.scene : scene));
      setSceneStatus('Настройки сцены сохранены в MongoDB.');
    } catch (error) { setSceneStatus(error.message); }
  };

  const uploadScene = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setSceneStatus('Файл должен быть не больше 8 MB.'); return; }
    setSceneStatus('Загружаю картинку…');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
        reader.readAsDataURL(file);
      });
      const body = await request('/api/driving-scenes', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Новая сцена',
          imageDataUrl,
          settings: DEFAULTS,
          lightsOn: false,
        }),
      });
      await refreshScenes(body.scene.id);
      setSceneStatus('Сцена загружена. Настройте её и нажмите «Сохранить».');
    } catch (error) { setSceneStatus(error.message); }
  };

  const deleteScene = async () => {
    if (!activeSceneId || !window.confirm(`Удалить сцену «${sceneName}»?`)) return;
    try {
      await request(`/api/driving-scenes/${activeSceneId}`, { method: 'DELETE' });
      setActiveSceneId('');
      await refreshScenes();
      setSceneStatus('Сцена удалена.');
    } catch (error) { setSceneStatus(error.message); }
  };

  const applySettingsBundle = (bundle, message) => {
    if (!bundle?.settings || typeof bundle.settings !== 'object') throw new Error('Файл не содержит настроек сцены.');
    const imported = Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [
      key,
      Number.isFinite(bundle.settings[key]) ? bundle.settings[key] : fallback,
    ]));
    setSettings(imported);
    setLightsOn(bundle.lightsOn === true);
    setSceneStatus(message);
  };

  const exportSettings = () => {
    const file = new Blob([JSON.stringify({
      format: 'taxi-driving-settings',
      version: 1,
      source: sceneName,
      settings,
      lightsOn,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sceneName.trim().replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '-') || 'taxi'}-settings.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSceneStatus('Настройки экспортированы в JSON.');
  };

  const importSettings = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (bundle.format !== 'taxi-driving-settings') throw new Error('Это не файл настроек Taxi Driving.');
      applySettingsBundle(bundle, 'Настройки импортированы. Нажмите «Сохранить», чтобы записать их для этой машины.');
    } catch (error) { setSceneStatus(error.message); }
  };

  const saveM3Reference = () => {
    const reference = { settings: { ...settings }, lightsOn };
    setM3Reference(reference);
    localStorage.setItem(M3_REFERENCE_KEY, JSON.stringify(reference));
    setSceneStatus('Текущие настройки сохранены как эталон M3.');
  };

  useEffect(() => {
    let active = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!active || !carCanvasRef.current) return;
      const canvas = carCanvasRef.current;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const source = context.getImageData(0, 0, canvas.width, canvas.height);
      const blackLayer = document.createElement('canvas');
      blackLayer.width = canvas.width;
      blackLayer.height = canvas.height;
      blackLayer.getContext('2d').putImageData(createBlackCarLayer(source), 0, 0);
      carImageRef.current = image;
      blackCarLayerRef.current = blackLayer;
      drawCar(canvas, image, blackLayer, blacknessRef.current);
    };
    image.onerror = () => { if (active) setSceneStatus('Не удалось загрузить картинку сцены.'); };
    image.src = sceneImageUrl;
    return () => { active = false; };
  }, [sceneImageUrl]);

  useEffect(() => {
    drawCar(carCanvasRef.current, carImageRef.current, blackCarLayerRef.current, settings.carBlackness);
  }, [settings.carBlackness]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, settings, lightsOn }));
    } catch {
      // The demo remains usable when storage is blocked by the browser.
    }
  }, [settings, lightsOn]);

  useEffect(() => {
    let frame;
    let previous = performance.now();
    const animate = (now) => {
      const elapsed = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (!paused && marksRef.current) {
        const spacing = settings.markSpacing;
        const easing = 1 - Math.exp(-elapsed * 6);
        currentSpeedRef.current += (targetSpeedRef.current - currentSpeedRef.current) * easing;
        offsetRef.current = (offsetRef.current + elapsed * currentSpeedRef.current) % spacing;
        const radians = settings.pathAngle * Math.PI / 180;
        const travel = offsetRef.current;
        marksRef.current.style.setProperty('--travel-x', `${travel * Math.cos(radians)}%`);
        marksRef.current.style.setProperty('--travel-y', `${travel * Math.sin(radians)}%`);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [paused, settings.markSpacing, settings.pathAngle]);

  const blink = (mode) => {
    const maxOpacity = settings.blinkOpacity / 100;
    const base = { opacity: 0, transform: 'translate(-50%, -50%) scale(.4)' };
    let keyframes;
    let duration;
    if (mode === 'double') {
      const pulse = settings.doublePulseDuration / settings.blinkSpeed;
      const gap = settings.doublePulseGap / settings.blinkSpeed;
      duration = pulse * 2 + gap;
      const firstEnd = pulse / duration;
      const secondStart = (pulse + gap) / duration;
      keyframes = [
        { ...base, offset: 0 },
        { opacity: maxOpacity, transform: 'translate(-50%, -50%) scale(1)', offset: firstEnd * .25 },
        { ...base, offset: firstEnd },
        { ...base, offset: secondStart },
        { opacity: maxOpacity * settings.doubleSecondOpacity / 100, transform: 'translate(-50%, -50%) scale(1)', offset: secondStart + (1 - secondStart) * .25 },
        { ...base, offset: 1 },
      ];
    } else {
      duration = 620 / settings.blinkSpeed;
      keyframes = [
        { ...base, offset: 0 },
        { opacity: maxOpacity, transform: 'translate(-50%, -50%) scale(1)', offset: .24 },
        { opacity: maxOpacity, transform: 'translate(-50%, -50%) scale(1)', offset: .54 },
        { ...base, offset: 1 },
      ];
    }
    headlightRefs.current.forEach((light) => {
      if (!light) return;
      light.getAnimations().forEach((animation) => animation.cancel());
      light.animate(keyframes, { duration, easing: 'ease-out' });
    });
  };

  const markStyle = {
    '--mark-width': `${settings.markWidth}%`,
    '--mark-angle': `${settings.pathAngle + settings.markAngle}deg`,
    '--mark-opacity': settings.markOpacity / 100,
  };
  const pathRadians = settings.pathAngle * Math.PI / 180;
  const pathX = Math.cos(pathRadians);
  const pathY = Math.sin(pathRadians);
  const spacing = settings.markSpacing;
  return (
    <main className="driving-demo">
      <header className="demo-header">
        <div>
          <p>Motion lab / NFT taxi</p>
          <h1>Driving configurator</h1>
        </div>
      </header>

      <section className="demo-layout">
        <div className="scene-shell">
          <div className="driving-scene">
            <canvas
              ref={carCanvasRef}
              className="car-shot"
              role="img"
              aria-label="Такси BMW M3 на дороге"
              style={{
                filter: `hue-rotate(${settings.backgroundHue}deg) saturate(${settings.backgroundSaturation}%) grayscale(${settings.backgroundGrayscale}%)`,
              }}
            />
            <div className="road-marks" ref={marksRef} style={markStyle} aria-hidden="true">
              {Array.from({ length: 32 }, (_, index) => {
                const slot = index - 16;
                const x = slot * spacing * pathX;
                const y = slot * spacing * pathY;
                return <img key={index} src="/driving-demo/mark.png" style={{ left: `${settings.markX + x}%`, top: `${settings.markY + y}%` }} alt="" />;
              })}
            </div>
            {[
              ['left', settings.leftX, settings.leftY],
              ['right', settings.rightX, settings.rightY],
            ].map(([name, x, y], index) => (
              <img
                key={name}
                ref={(element) => { headlightRefs.current[index] = element; }}
                className={`headlight headlight-${name} ${lightsOn ? 'lights-on' : ''}`}
                src="/driving-demo/blink.png"
                alt=""
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${settings.blinkSize}%`,
                  '--blink-opacity': settings.blinkOpacity / 100,
                }}
              />
            ))}
            <div className="scene-status"><i />{paused ? 'Пауза' : 'Симуляция движения'}</div>
          </div>
          <div className="scene-actions">
            <button className="primary-action" onClick={() => blink('single')}>✦ Моргнуть</button>
            <button onClick={() => blink('double')}>✦✦ Двойной сигнал</button>
            <button onClick={() => setPaused((value) => !value)}>{paused ? '▶ Продолжить' : 'Ⅱ Пауза'}</button>
          </div>
        </div>

        <aside className="demo-controls">
          <div className="controls-title">
            <div><small>Настройки сцены</small><h2>Конфигуратор</h2></div>
            <button onClick={() => setSettings(DEFAULTS)}>Сбросить</button>
          </div>

          <fieldset className="scene-library">
            <legend>Библиотека сцен</legend>
            <label className="text-control">Сцена
              <select value={activeSceneId} onChange={(event) => selectScene(scenes.find((scene) => scene.id === event.target.value))}>
                <option value="">Локальное демо</option>
                {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
              </select>
            </label>
            <label className="text-control">Название<input value={sceneName} maxLength={80} onChange={(event) => setSceneName(event.target.value)} /></label>
            <div className="scene-library-actions">
              <label className="upload-button">＋ Загрузить<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadScene} /></label>
              <button className="save-scene" type="button" onClick={saveScene}>Сохранить</button>
              <button type="button" onClick={deleteScene} disabled={!activeSceneId}>Удалить</button>
            </div>
            <div className="settings-transfer">
              <button type="button" onClick={() => applySettingsBundle(
                { ...m3Reference, lightsOn: true },
                'Эталон M3 применён, фары включены для проверки. Нажмите «Сохранить» для записи в MongoDB.',
              )}>Применить эталон M3</button>
              <button type="button" onClick={saveM3Reference}>Обновить эталон M3</button>
              <button type="button" onClick={exportSettings}>Экспорт JSON</button>
              <label>Импорт JSON<input type="file" accept="application/json,.json" onChange={importSettings} /></label>
            </div>
            {sceneStatus && <p className="scene-message">{sceneStatus}</p>}
          </fieldset>

          <fieldset>
            <legend>Движение</legend>
            <Range label="Скорость разметки" value={settings.markSpeed} min={0} max={60} step={0.5} unit="%/с" onChange={update('markSpeed')} />
            <Range label="Угол траектории" value={settings.pathAngle} min={-180} max={180} step={0.1} unit="°" onChange={update('pathAngle')} />
            <div className="angle-stepper" aria-label="Изменить угол траектории">
              <button onClick={() => update('pathAngle')(Math.max(-180, Math.round((settings.pathAngle - 0.1) * 10) / 10))}>−0.1°</button>
              <span>{settings.pathAngle}°</span>
              <button onClick={() => update('pathAngle')(Math.min(180, Math.round((settings.pathAngle + 0.1) * 10) / 10))}>+0.1°</button>
            </div>
            <div className="direction-control">
              <span>Куда движутся полоски</span>
              <div className="direction-pad" aria-label="Направление движения разметки">
                {DIRECTION_PRESETS.map((preset) => (
                  <button
                    key={preset.angle}
                    className={settings.pathAngle === preset.angle ? 'active' : ''}
                    title={preset.title}
                    aria-label={preset.title}
                    style={{ gridColumn: preset.column, gridRow: preset.row }}
                    onClick={() => update('pathAngle')(preset.angle)}
                  >{preset.label}</button>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend>Разметка</legend>
            <Range label="Положение по X" value={settings.markX} min={0} max={100} unit="%" onChange={update('markX')} />
            <Range label="Положение по Y" value={settings.markY} min={65} max={100} unit="%" onChange={update('markY')} />
            <Range label="Размер полоски" value={settings.markWidth} min={3} max={35} step={0.5} unit="%" onChange={update('markWidth')} />
            <Range label="Между центрами" value={settings.markSpacing} min={6} max={72} step={0.5} unit="%" onChange={update('markSpacing')} />
            <Range label="Прозрачность" value={settings.markOpacity} min={0} max={100} step={5} unit="%" onChange={update('markOpacity')} />
            <Range label="Доп. поворот элементов" value={settings.markAngle} min={-180} max={180} step={0.1} unit="°" onChange={update('markAngle')} />
            <div className="angle-stepper" aria-label="Скорректировать поворот элементов">
              <button onClick={() => update('markAngle')(Math.max(-180, Math.round((settings.markAngle - 0.1) * 10) / 10))}>−0.1°</button>
              <span>{settings.markAngle}°</span>
              <button onClick={() => update('markAngle')(Math.min(180, Math.round((settings.markAngle + 0.1) * 10) / 10))}>+0.1°</button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Цвет машины</legend>
            <Range label="Чернота жёлтых частей" value={settings.carBlackness} min={0} max={100} step={5} unit="%" onChange={update('carBlackness')} />
            <p className="control-note">Меняется только жёлтый кузов, тени и блики сохраняются.</p>
          </fieldset>

          <fieldset>
            <legend>Фоновая картинка</legend>
            <button
              type="button"
              className="filter-reset"
              onClick={() => setSettings((current) => ({
                ...current,
                backgroundHue: DEFAULTS.backgroundHue,
                backgroundSaturation: DEFAULTS.backgroundSaturation,
                backgroundGrayscale: DEFAULTS.backgroundGrayscale,
              }))}
            >
              Сбросить только цвета
            </button>
            <button
              className={`lights-toggle color-toggle ${settings.backgroundGrayscale === 100 ? 'active' : ''}`}
              type="button"
              role="switch"
              aria-checked={settings.backgroundGrayscale === 100}
              onClick={() => update('backgroundGrayscale')(settings.backgroundGrayscale === 100 ? 0 : 100)}
            >
              <span><i />Градации серого</span>
              <b>{settings.backgroundGrayscale === 100 ? 'Включены' : 'Выключены'}</b>
            </button>
            <Range label="Hue rotate" value={settings.backgroundHue} min={0} max={360} unit="°" onChange={update('backgroundHue')} />
            <Range label="Насыщенность" value={settings.backgroundSaturation} min={0} max={250} step={5} unit="%" onChange={update('backgroundSaturation')} />
          </fieldset>

          <fieldset>
            <legend>Фары</legend>
            <button
              className={`lights-toggle ${lightsOn ? 'active' : ''}`}
              type="button"
              role="switch"
              aria-checked={lightsOn}
              onClick={() => setLightsOn((value) => !value)}
            >
              <span><i />Постоянный свет</span>
              <b>{lightsOn ? 'Включён' : 'Выключен'}</b>
            </button>
            <Range label="Размер блика" value={settings.blinkSize} min={3} max={25} unit="%" onChange={update('blinkSize')} />
            <Range label="Скорость вспышки" value={settings.blinkSpeed} min={0.25} max={3} step={0.05} unit="×" onChange={update('blinkSpeed')} />
            <Range label="Макс. непрозрачность" value={settings.blinkOpacity} min={5} max={100} step={5} unit="%" onChange={update('blinkOpacity')} />
            <div className="control-subsection">Двойной сигнал</div>
            <Range label="Длительность импульса" value={settings.doublePulseDuration} min={80} max={600} step={10} unit=" мс" onChange={update('doublePulseDuration')} />
            <Range label="Пауза между импульсами" value={settings.doublePulseGap} min={0} max={1000} step={10} unit=" мс" onChange={update('doublePulseGap')} />
            <Range label="Яркость второго" value={settings.doubleSecondOpacity} min={10} max={100} step={5} unit="%" onChange={update('doubleSecondOpacity')} />
            <div className="light-grid">
              <div>
                <b>Левая</b>
                <Range label="X" value={settings.leftX} min={0} max={100} step={0.1} unit="%" onChange={update('leftX')} />
                <FinePositionButtons value={settings.leftX} onChange={update('leftX')} />
                <Range label="Y" value={settings.leftY} min={0} max={100} step={0.1} unit="%" onChange={update('leftY')} />
                <FinePositionButtons value={settings.leftY} onChange={update('leftY')} />
              </div>
              <div>
                <b>Правая</b>
                <Range label="X" value={settings.rightX} min={0} max={100} step={0.1} unit="%" onChange={update('rightX')} />
                <FinePositionButtons value={settings.rightX} onChange={update('rightX')} />
                <Range label="Y" value={settings.rightY} min={0} max={100} step={0.1} unit="%" onChange={update('rightY')} />
                <FinePositionButtons value={settings.rightY} onChange={update('rightY')} />
              </div>
            </div>
          </fieldset>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<DrivingDemo />);
