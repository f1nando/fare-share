import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './driving-demo.css';

const DEFAULTS = {
  markSpeed: 240,
  markSpacing: 460,
  pathAngle: -135,
  markX: 50,
  markY: 84,
  markWidth: 210,
  markAngle: 0,
  markStagger: 0,
  markOpacity: 100,
  leftX: 65,
  leftY: 59,
  rightX: 83,
  rightY: 60,
  blinkSize: 12,
  blinkSpeed: 1,
  blinkOpacity: 100,
};
const STORAGE_KEY = 'taxi-driving-demo-settings-v1';
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

function loadStoredState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== 'object') throw new Error('Empty settings');
    const settings = Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, fallback]) => [
        key,
        Number.isFinite(stored.settings?.[key]) ? stored.settings[key] : fallback,
      ]),
    );
    if (!Number.isFinite(stored.settings?.markSpacing) && Number.isFinite(stored.settings?.markGap)) {
      settings.markSpacing = stored.settings.markGap + (Number.isFinite(stored.settings.markWidth) ? stored.settings.markWidth : DEFAULTS.markWidth);
    }
    if (stored.settings?.direction === -1 && Number.isFinite(stored.settings?.pathAngle)) {
      settings.pathAngle = normalizeAngle(settings.pathAngle + 180);
    }
    return { settings, lightsOn: stored.lightsOn === true };
  } catch {
    return { settings: DEFAULTS, lightsOn: false };
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

function DrivingDemo() {
  const [initialState] = useState(loadStoredState);
  const [settings, setSettings] = useState(initialState.settings);
  const [paused, setPaused] = useState(false);
  const [blinkMode, setBlinkMode] = useState('off');
  const [lightsOn, setLightsOn] = useState(initialState.lightsOn);
  const marksRef = useRef(null);
  const offsetRef = useRef(0);
  const targetSpeedRef = useRef(settings.markSpeed);
  const currentSpeedRef = useRef(settings.markSpeed);
  targetSpeedRef.current = settings.markSpeed;
  const update = (key) => (value) => setSettings((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, lightsOn }));
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
        // Two slots keep the alternating lateral offset seamless at the loop boundary.
        offsetRef.current = (offsetRef.current + elapsed * currentSpeedRef.current) % (spacing * 2);
        const radians = settings.pathAngle * Math.PI / 180;
        const travel = offsetRef.current;
        marksRef.current.style.setProperty('--travel-x', `${travel * Math.cos(radians)}px`);
        marksRef.current.style.setProperty('--travel-y', `${travel * Math.sin(radians)}px`);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [paused, settings.markSpacing, settings.pathAngle]);

  const blink = (mode) => {
    setBlinkMode('off');
    requestAnimationFrame(() => setBlinkMode(mode));
  };

  const markStyle = {
    '--mark-width': `${settings.markWidth}px`,
    '--mark-angle': `${settings.markAngle}deg`,
    '--mark-opacity': settings.markOpacity / 100,
  };
  const pathRadians = settings.pathAngle * Math.PI / 180;
  const pathX = Math.cos(pathRadians);
  const pathY = Math.sin(pathRadians);
  const normalX = -pathY;
  const normalY = pathX;
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
            <img className="car-shot" src="/driving-demo/m3.png" alt="Жёлтое такси BMW M3 на дороге" />
            <div className="road-marks" ref={marksRef} style={markStyle} aria-hidden="true">
              {Array.from({ length: 32 }, (_, index) => {
                const slot = index - 16;
                const stagger = (index % 2 ? 1 : -1) * settings.markStagger / 2;
                const x = slot * spacing * pathX + stagger * normalX;
                const y = slot * spacing * pathY + stagger * normalY;
                return <img key={index} src="/driving-demo/mark.png" style={{ left: `calc(${settings.markX}% + ${x}px)`, top: `calc(${settings.markY}% + ${y}px)` }} alt="" />;
              })}
            </div>
            {[
              ['left', settings.leftX, settings.leftY],
              ['right', settings.rightX, settings.rightY],
            ].map(([name, x, y]) => (
              <img
                key={`${name}-${blinkMode}`}
                className={`headlight headlight-${name} blink-${blinkMode} ${lightsOn ? 'lights-on' : ''}`}
                src="/driving-demo/blink.png"
                alt=""
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${settings.blinkSize}%`,
                  '--blink-opacity': settings.blinkOpacity / 100,
                  '--single-duration': `${0.62 / settings.blinkSpeed}s`,
                  '--double-duration': `${1.15 / settings.blinkSpeed}s`,
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

          <fieldset>
            <legend>Движение</legend>
            <Range label="Скорость разметки" value={settings.markSpeed} min={0} max={600} unit=" px/s" onChange={update('markSpeed')} />
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
            <Range label="Размер полоски" value={settings.markWidth} min={70} max={420} unit=" px" onChange={update('markWidth')} />
            <Range label="Между центрами" value={settings.markSpacing} min={80} max={900} unit=" px" onChange={update('markSpacing')} />
            <Range label="Прозрачность" value={settings.markOpacity} min={0} max={100} step={5} unit="%" onChange={update('markOpacity')} />
            <Range label="Поворот элементов" value={settings.markAngle} min={-180} max={180} unit="°" onChange={update('markAngle')} />
            <Range label="Сдвиг соседних" value={settings.markStagger} min={-250} max={250} unit=" px" onChange={update('markStagger')} />
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
            <div className="light-grid">
              <div><b>Левая</b><Range label="X" value={settings.leftX} min={0} max={100} unit="%" onChange={update('leftX')} /><Range label="Y" value={settings.leftY} min={0} max={100} unit="%" onChange={update('leftY')} /></div>
              <div><b>Правая</b><Range label="X" value={settings.rightX} min={0} max={100} unit="%" onChange={update('rightX')} /><Range label="Y" value={settings.rightY} min={0} max={100} unit="%" onChange={update('rightY')} /></div>
            </div>
          </fieldset>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<DrivingDemo />);
