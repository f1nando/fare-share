import { useEffect, useRef, useState } from 'react';
import { createCity } from './city/createCity.js';
import { loadSettings, saveSettings } from './city/settings.js';
import { SettingsPanel } from './SettingsPanel.jsx';

/** Set showSettings=false when embedding the scene as a clean background. */
export function CityBackground({ className = '', showSettings = true, fixed = false }) {
  const container = useRef(null);
  const city = useRef(null);
  const [settings, setSettings] = useState(loadSettings);
  const initialSettings = useRef(settings);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      city.current = createCity(container.current, initialSettings.current);
      return () => { city.current?.dispose(); city.current = null; };
    } catch (error) {
      console.error('Unable to start the city background', error);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    city.current?.updateSettings(settings);
    const timer = setTimeout(() => saveSettings(settings), 200);
    return () => clearTimeout(timer);
  }, [settings]);

  return (
    <div className={`city-background ${fixed ? 'is-fixed' : ''} ${className}`}>
      <div className="city-canvas" ref={container} role="img" aria-label="Бесконечный лоу-поли город: деревья, серые домики и жёлтые такси в движении" />
      {failed && <p className="city-error">Для отображения города нужен браузер с поддержкой WebGL 2.</p>}
      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} />}
    </div>
  );
}
