import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './driving-demo.css';

const DEFAULTS = {
  carSpeed: 72,
  markSpeed: 240,
  markGap: 250,
  direction: -1,
  markY: 84,
  markWidth: 210,
  markAngle: 0,
  leftX: 65,
  leftY: 59,
  rightX: 83,
  rightY: 60,
  blinkSize: 12,
};

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
  const [settings, setSettings] = useState(DEFAULTS);
  const [paused, setPaused] = useState(false);
  const [blinkMode, setBlinkMode] = useState('off');
  const sceneRef = useRef(null);
  const marksRef = useRef(null);
  const offsetRef = useRef(0);
  const update = (key) => (value) => setSettings((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let frame;
    let previous = performance.now();
    const animate = (now) => {
      const elapsed = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (!paused && marksRef.current) {
        const spacing = settings.markGap + settings.markWidth;
        offsetRef.current = (offsetRef.current + elapsed * settings.markSpeed) % spacing;
        marksRef.current.style.setProperty('--travel', `${offsetRef.current * settings.direction}px`);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [paused, settings.direction, settings.markGap, settings.markSpeed, settings.markWidth]);

  const blink = (mode) => {
    setBlinkMode('off');
    requestAnimationFrame(() => setBlinkMode(mode));
  };

  const markStyle = {
    '--mark-gap': `${settings.markGap}px`,
    '--mark-width': `${settings.markWidth}px`,
    '--mark-y': `${settings.markY}%`,
    '--mark-angle': `${settings.markAngle}deg`,
  };
  const vibration = paused ? 0 : settings.carSpeed / 160;

  return (
    <main className="driving-demo">
      <header className="demo-header">
        <div>
          <p>Motion lab / NFT taxi</p>
          <h1>Driving configurator</h1>
        </div>
        <div className="speed-readout"><strong>{settings.carSpeed}</strong><span>км/ч</span></div>
      </header>

      <section className="demo-layout">
        <div className="scene-shell">
          <div
            className={`driving-scene ${paused ? 'is-paused' : ''}`}
            ref={sceneRef}
            style={{ '--vibration': `${vibration}px` }}
          >
            <img className="car-shot" src="/driving-demo/m3.png" alt="Жёлтое такси BMW M3 на дороге" />
            <div className="road-marks" ref={marksRef} style={markStyle} aria-hidden="true">
              {Array.from({ length: 24 }, (_, index) => (
                <img key={index} src="/driving-demo/mark.png" style={{ '--index': index }} alt="" />
              ))}
            </div>
            {[
              ['left', settings.leftX, settings.leftY],
              ['right', settings.rightX, settings.rightY],
            ].map(([name, x, y]) => (
              <img
                key={`${name}-${blinkMode}`}
                className={`headlight headlight-${name} blink-${blinkMode}`}
                src="/driving-demo/blink.png"
                alt=""
                style={{ left: `${x}%`, top: `${y}%`, width: `${settings.blinkSize}%` }}
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
            <Range label="Скорость авто" value={settings.carSpeed} min={0} max={220} unit=" км/ч" onChange={update('carSpeed')} />
            <Range label="Скорость разметки" value={settings.markSpeed} min={0} max={600} unit=" px/s" onChange={update('markSpeed')} />
            <Range label="Интервал" value={settings.markGap} min={30} max={700} unit=" px" onChange={update('markGap')} />
            <div className="segmented" aria-label="Направление движения разметки">
              <button className={settings.direction === -1 ? 'active' : ''} onClick={() => update('direction')(-1)}>← Влево</button>
              <button className={settings.direction === 1 ? 'active' : ''} onClick={() => update('direction')(1)}>Вправо →</button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Разметка</legend>
            <Range label="Положение по Y" value={settings.markY} min={65} max={100} unit="%" onChange={update('markY')} />
            <Range label="Ширина" value={settings.markWidth} min={70} max={420} unit=" px" onChange={update('markWidth')} />
            <Range label="Наклон" value={settings.markAngle} min={-25} max={25} unit="°" onChange={update('markAngle')} />
          </fieldset>

          <fieldset>
            <legend>Фары</legend>
            <Range label="Размер блика" value={settings.blinkSize} min={3} max={25} unit="%" onChange={update('blinkSize')} />
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
