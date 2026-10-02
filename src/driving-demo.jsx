import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './clientErrorLog.js';
import { RoadMarkStrip } from './RoadMarkStrip.jsx';
import { BACKEND_URL as API_BASE } from './backendUrl.js';
import { notifyError, notifyLoading, notifySuccess } from './siteToasts.js';
import './driving-demo.css';

const DEFAULTS = {
  markSpeed: 19,
  markSpacing: 37,
  pathAngle: -135,
  markX: 50,
  markY: 84,
  markWidth: 17,
  markAngleOffset: 0,
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
const BMW_M3_E46_REFERENCE_KEY = 'taxi-driving-demo-bmw-m3-e46-reference-v1';
const SETTINGS_VERSION = 2;
const SOURCE_IMAGE_SIZE = 1254;
const VEHICLE_CLASSES = ['Economy', 'Comfort', 'Business', 'Legendary', 'Trainee'];
const DIRECTION_PRESETS = [
  { angle: -135, label: '↖', title: 'Up and left', column: 1, row: 1 },
  { angle: -90, label: '↑', title: 'Up', column: 2, row: 1 },
  { angle: -45, label: '↗', title: 'Up and right', column: 3, row: 1 },
  { angle: -180, label: '←', title: 'Left', column: 1, row: 2 },
  { angle: 0, label: '→', title: 'Right', column: 3, row: 2 },
  { angle: 135, label: '↙', title: 'Down and left', column: 1, row: 3 },
  { angle: 90, label: '↓', title: 'Down', column: 2, row: 3 },
  { angle: 45, label: '↘', title: 'Down and right', column: 3, row: 3 },
];

function normalizeAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function normalizeVehicleClass(value) {
  if (value === 'Legend') return 'Legendary';
  return VEHICLE_CLASSES.includes(value) ? value : 'Economy';
}

function normalizeSettings(source) {
  const migrated = { ...source };
  if (!Number.isFinite(migrated.markAngleOffset) && Number.isFinite(migrated.markAngle)) {
    const pathAngle = Number.isFinite(migrated.pathAngle) ? migrated.pathAngle : DEFAULTS.pathAngle;
    migrated.markAngleOffset = Math.round(normalizeAngle(migrated.markAngle - pathAngle) * 10) / 10;
  }
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [
    key,
    Number.isFinite(migrated[key]) ? migrated[key] : fallback,
  ]));
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

async function imageFileToWebPDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const webp = await new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('The browser could not create a WebP image.')),
    'image/webp',
    .84,
  ));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not prepare the WebP image.'));
    reader.readAsDataURL(webp);
  });
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
    const settings = normalizeSettings(source);
    return {
      settings,
      lightsOn: stored.lightsOn === true,
      vehicleClass: normalizeVehicleClass(stored.vehicleClass),
    };
  } catch {
    return { settings: DEFAULTS, lightsOn: false, vehicleClass: 'Economy' };
  }
}

function loadBmwM3E46Reference(fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(BMW_M3_E46_REFERENCE_KEY));
    if (!stored?.settings) throw new Error('Empty reference');
    return {
      settings: normalizeSettings(stored.settings),
      lightsOn: stored.lightsOn === true,
    };
  } catch {
    const reference = { settings: { ...fallback.settings }, lightsOn: fallback.lightsOn };
    localStorage.setItem(BMW_M3_E46_REFERENCE_KEY, JSON.stringify(reference));
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
      <button type="button" onClick={() => adjust(-0.4)}>−0.4</button>
      <button type="button" onClick={() => adjust(0.4)}>+0.4</button>
    </div>
  );
}

function DrivingDemo() {
  const [initialState] = useState(loadStoredState);
  const [bmwM3E46Reference] = useState(() => loadBmwM3E46Reference(initialState));
  const [settings, setSettings] = useState(initialState.settings);
  const [paused, setPaused] = useState(false);
  const [lightsOn, setLightsOn] = useState(false);
  const [vehicleClass, setVehicleClass] = useState(initialState.vehicleClass);
  const [compactSpacingPreview, setCompactSpacingPreview] = useState(false);
  const [scenes, setScenes] = useState([]);
  const [activeSceneId, setActiveSceneId] = useState('');
  const [sceneName, setSceneName] = useState('Local demo');
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
  const databaseBmwM3E46 = scenes.find((scene) => scene.name.trim().toLowerCase() === 'bmw m3 e46');
  const sceneImageUrl = activeScene ? `${API_BASE}${activeScene.imageUrl}` : '/driving-demo/bmw-m3-e46.webp';

  const selectScene = (scene) => {
    setActiveSceneId(scene?.id || '');
    setSceneName(scene?.name || 'Local demo');
    if (scene) {
      setSettings(normalizeSettings(scene.settings));
      setVehicleClass(normalizeVehicleClass(scene.vehicleClass));
      setCompactSpacingPreview(false);
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
      setSceneStatus(body.scenes.length ? '' : 'There are no scenes in the database yet. Upload the first image.');
    } catch (error) {
      setSceneStatus(`Backend unavailable: ${error.message}`);
    }
  };

  useEffect(() => { refreshScenes(); }, []);

  const saveScene = async () => {
    if (!activeSceneId) { const message = 'Upload and select a scene first.'; setSceneStatus(message); notifyError(message); return; }
    setSceneStatus('Saving…');
    const toastId = notifyLoading('Saving scene settings…');
    try {
      const body = await request(`/api/driving-scenes/${activeSceneId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: sceneName, settings, vehicleClass, lightsOn: false }),
      });
      setScenes((current) => current.map((scene) => scene.id === body.scene.id ? body.scene : scene));
      setSceneStatus('Scene settings saved to MongoDB.');
      notifySuccess('Scene settings saved.', { id: toastId });
    } catch (error) { setSceneStatus(error.message); notifyError(error.message, { id: toastId }); }
  };

  const uploadScene = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { const message = 'The file must not exceed 8 MB.'; setSceneStatus(message); notifyError(message); return; }
    setSceneStatus('Converting the image to WebP…');
    const toastId = notifyLoading('Uploading and converting the scene…');
    try {
      const imageDataUrl = await imageFileToWebPDataUrl(file);
      const body = await request('/api/driving-scenes', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'New scene',
          imageDataUrl,
          settings: DEFAULTS,
          vehicleClass,
          lightsOn: false,
        }),
      });
      await refreshScenes(body.scene.id);
      setSceneStatus('Scene uploaded. Configure it and click Save.');
      notifySuccess('Scene uploaded. Configure it and click Save.', { id: toastId });
    } catch (error) { setSceneStatus(error.message); notifyError(error.message, { id: toastId }); }
  };

  const deleteScene = async () => {
    if (!activeSceneId || !window.confirm(`Delete the scene “${sceneName}”?`)) return;
    const toastId = notifyLoading('Deleting scene…');
    try {
      await request(`/api/driving-scenes/${activeSceneId}`, { method: 'DELETE' });
      setActiveSceneId('');
      await refreshScenes();
      setSceneStatus('Scene deleted.');
      notifySuccess('Scene deleted.', { id: toastId });
    } catch (error) { setSceneStatus(error.message); notifyError(error.message, { id: toastId }); }
  };

  const applySettingsBundle = (bundle, message) => {
    if (!bundle?.settings || typeof bundle.settings !== 'object') throw new Error('The file does not contain scene settings.');
    const imported = normalizeSettings(bundle.settings);
    setSettings(imported);
    if (bundle.vehicleClass) setVehicleClass(normalizeVehicleClass(bundle.vehicleClass));
    setSceneStatus(message);
  };

  const exportSettings = () => {
    const file = new Blob([JSON.stringify({
      format: 'taxi-driving-settings',
      version: 1,
      source: sceneName,
      vehicleClass,
      settings,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sceneName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-') || 'taxi'}-settings.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSceneStatus('Settings exported to JSON.');
    notifySuccess('Settings exported to JSON.');
  };

  const importSettings = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (bundle.format !== 'taxi-driving-settings') throw new Error('This is not a Taxi Driving settings file.');
      applySettingsBundle(bundle, 'Settings imported. Click Save to store them for this car.');
      notifySuccess('Settings imported. Click Save to store them for this car.');
    } catch (error) { setSceneStatus(error.message); notifyError(error.message); }
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
    image.onerror = () => { if (active) setSceneStatus('Could not load the scene image.'); };
    image.src = sceneImageUrl;
    return () => { active = false; };
  }, [sceneImageUrl]);

  useEffect(() => {
    drawCar(carCanvasRef.current, carImageRef.current, blackCarLayerRef.current, settings.carBlackness);
  }, [settings.carBlackness]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SETTINGS_VERSION, settings, vehicleClass }));
    } catch {
      // The demo remains usable when storage is blocked by the browser.
    }
  }, [settings, vehicleClass]);

  useEffect(() => {
    let frame;
    let previous = performance.now();
    const animate = (now) => {
      const elapsed = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (!paused && marksRef.current) {
        const spacing = compactSpacingPreview ? 15 : settings.markSpacing;
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
  }, [paused, compactSpacingPreview, settings.markSpacing, settings.pathAngle]);

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

  const spacing = compactSpacingPreview ? 15 : settings.markSpacing;
  const markY = compactSpacingPreview ? 77 : settings.markY;
  const previewSettings = { ...settings, markSpacing: spacing, markY };
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
              aria-label="BMW M3 E46 taxi on the road"
              style={{
                filter: `hue-rotate(${settings.backgroundHue}deg) saturate(${settings.backgroundSaturation}%) grayscale(${settings.backgroundGrayscale}%)`,
              }}
            />
            <div className="road-marks" ref={marksRef} aria-hidden="true">
              <RoadMarkStrip className="road-mark-line" settings={previewSettings} />
            </div>
            {[
              ['left', settings.leftX, settings.leftY],
              ['right', settings.rightX, settings.rightY],
            ].map(([name, x, y], index) => (
              <img
                key={name}
                ref={(element) => { headlightRefs.current[index] = element; }}
                className={`headlight headlight-${name} ${lightsOn ? 'lights-on' : ''}`}
                src="/driving-demo/blink.webp"
                alt=""
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${settings.blinkSize}%`,
                  '--blink-opacity': settings.blinkOpacity / 100,
                }}
              />
            ))}
            <div className="scene-status"><i />{paused ? 'Paused' : 'Driving simulation'}</div>
          </div>
          <div className="scene-actions">
            <button className="primary-action" onClick={() => blink('single')}>✦ Flash</button>
            <button onClick={() => blink('double')}>✦✦ Double flash</button>
            <button onClick={() => setPaused((value) => !value)}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button>
          </div>
        </div>

        <aside className="demo-controls">
          <div className="controls-title">
            <div><small>Scene settings</small><h2>Configurator</h2></div>
            <button onClick={() => setSettings(DEFAULTS)}>Reset</button>
          </div>

          <div className="global-light-control">
            <button
              className={`lights-toggle ${lightsOn ? 'active' : ''}`}
              type="button"
              role="switch"
              aria-checked={lightsOn}
              onClick={() => setLightsOn((value) => !value)}
            >
              <span><i />Headlights for all cars</span>
              <b>{lightsOn ? 'On' : 'Off'}</b>
            </button>
            <small>Editor preview only. This is not saved to the car settings.</small>
          </div>

          <fieldset className="scene-library">
            <legend>Scene library</legend>
            <label className="text-control">Scene
              <select value={activeSceneId} onChange={(event) => selectScene(scenes.find((scene) => scene.id === event.target.value))}>
                <option value="">Local demo</option>
                {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
              </select>
            </label>
            <label className="text-control">Car class
              <select value={vehicleClass} onChange={(event) => setVehicleClass(event.target.value)}>
                {VEHICLE_CLASSES.map((className) => <option key={className} value={className}>{className}</option>)}
              </select>
            </label>
            <label className="text-control">Name<input value={sceneName} maxLength={80} onChange={(event) => setSceneName(event.target.value)} /></label>
            <div className="scene-library-actions">
              <label className="upload-button">＋ Upload<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadScene} /></label>
              <button className="save-scene" type="button" onClick={saveScene}>Save</button>
              <button
                className={`spacing-preview-action ${compactSpacingPreview ? 'active' : ''}`}
                type="button"
                aria-pressed={compactSpacingPreview}
                title="Temporarily set center spacing to 15% and Y position to 77%"
                onClick={() => setCompactSpacingPreview((value) => !value)}
              >15% / Y 77%</button>
              <button type="button" onClick={deleteScene} disabled={!activeSceneId}>Delete</button>
            </div>
            <div className="settings-transfer">
              <button type="button" onClick={() => applySettingsBundle(
                { settings: databaseBmwM3E46?.settings || bmwM3E46Reference.settings },
                `${databaseBmwM3E46 ? 'BMW M3 E46 scene reference' : 'Local BMW M3 E46 reference'} applied. Click Save to store it in MongoDB.`,
              )}>Apply BMW M3 E46 reference</button>
              <button type="button" onClick={exportSettings}>Export JSON</button>
              <label>Import JSON<input type="file" accept="application/json,.json" onChange={importSettings} /></label>
            </div>
            {sceneStatus && <p className="scene-message">{sceneStatus}</p>}
          </fieldset>

          <fieldset>
            <legend>Movement</legend>
            <Range label="Marking speed" value={settings.markSpeed} min={0} max={60} step={0.5} unit="%/s" onChange={update('markSpeed')} />
            <Range label="Path angle" value={settings.pathAngle} min={-180} max={180} step={0.1} unit="°" onChange={update('pathAngle')} />
            <div className="angle-stepper" aria-label="Adjust path angle">
              <button onClick={() => update('pathAngle')(Math.max(-180, Math.round((settings.pathAngle - 0.1) * 10) / 10))}>−0.1°</button>
              <span>{settings.pathAngle}°</span>
              <button onClick={() => update('pathAngle')(Math.min(180, Math.round((settings.pathAngle + 0.1) * 10) / 10))}>+0.1°</button>
            </div>
            <div className="direction-control">
              <span>Marking movement direction</span>
              <div className="direction-pad" aria-label="Road marking movement direction">
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
            <legend>Road markings</legend>
            <Range label="X position" value={settings.markX} min={0} max={100} unit="%" onChange={update('markX')} />
            <Range label="Y position" value={settings.markY} min={65} max={100} unit="%" onChange={update('markY')} />
            <Range label="Mark width" value={settings.markWidth} min={3} max={35} step={0.5} unit="%" onChange={update('markWidth')} />
            <Range label="Center spacing" value={settings.markSpacing} min={6} max={72} step={0.5} unit="%" onChange={update('markSpacing')} />
            <Range label="Opacity" value={settings.markOpacity} min={0} max={100} step={5} unit="%" onChange={update('markOpacity')} />
            <Range label="Additional element rotation" value={settings.markAngleOffset} min={-180} max={180} step={0.1} unit="°" onChange={update('markAngleOffset')} />
            <div className="angle-stepper" aria-label="Adjust element rotation">
              <button onClick={() => update('markAngleOffset')(Math.max(-180, Math.round((settings.markAngleOffset - 0.1) * 10) / 10))}>−0.1°</button>
              <span>{settings.markAngleOffset}°</span>
              <button onClick={() => update('markAngleOffset')(Math.min(180, Math.round((settings.markAngleOffset + 0.1) * 10) / 10))}>+0.1°</button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Car color</legend>
            <Range label="Black level of yellow parts" value={settings.carBlackness} min={0} max={100} step={5} unit="%" onChange={update('carBlackness')} />
            <p className="control-note">Only the yellow body changes; shadows and highlights are preserved.</p>
          </fieldset>

          <fieldset>
            <legend>Background image</legend>
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
              Reset colors only
            </button>
            <button
              className={`lights-toggle color-toggle ${settings.backgroundGrayscale === 100 ? 'active' : ''}`}
              type="button"
              role="switch"
              aria-checked={settings.backgroundGrayscale === 100}
              onClick={() => update('backgroundGrayscale')(settings.backgroundGrayscale === 100 ? 0 : 100)}
            >
              <span><i />Grayscale</span>
              <b>{settings.backgroundGrayscale === 100 ? 'On' : 'Off'}</b>
            </button>
            <Range label="Hue rotate" value={settings.backgroundHue} min={0} max={360} unit="°" onChange={update('backgroundHue')} />
            <Range label="Saturation" value={settings.backgroundSaturation} min={0} max={250} step={5} unit="%" onChange={update('backgroundSaturation')} />
          </fieldset>

          <fieldset>
            <legend>Headlights</legend>
            <Range label="Flare size" value={settings.blinkSize} min={3} max={25} unit="%" onChange={update('blinkSize')} />
            <Range label="Flash speed" value={settings.blinkSpeed} min={0.25} max={3} step={0.05} unit="×" onChange={update('blinkSpeed')} />
            <Range label="Maximum opacity" value={settings.blinkOpacity} min={5} max={100} step={5} unit="%" onChange={update('blinkOpacity')} />
            <div className="control-subsection">Double flash</div>
            <Range label="Pulse duration" value={settings.doublePulseDuration} min={80} max={600} step={10} unit=" ms" onChange={update('doublePulseDuration')} />
            <Range label="Gap between pulses" value={settings.doublePulseGap} min={0} max={1000} step={10} unit=" ms" onChange={update('doublePulseGap')} />
            <Range label="Second flash brightness" value={settings.doubleSecondOpacity} min={10} max={100} step={5} unit="%" onChange={update('doubleSecondOpacity')} />
            <div className="light-grid">
              <div>
                <b>Left</b>
                <Range label="X" value={settings.leftX} min={0} max={100} step={0.1} unit="%" onChange={update('leftX')} />
                <FinePositionButtons value={settings.leftX} onChange={update('leftX')} />
                <Range label="Y" value={settings.leftY} min={0} max={100} step={0.1} unit="%" onChange={update('leftY')} />
                <FinePositionButtons value={settings.leftY} onChange={update('leftY')} />
              </div>
              <div>
                <b>Right</b>
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
