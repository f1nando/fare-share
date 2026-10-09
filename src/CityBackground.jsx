import { useEffect, useRef, useState } from 'react';
import { createCity } from './city/createCity.js';
import { loadSettings, saveSettings } from './city/settings.js';
import { SettingsPanel } from './SettingsPanel.jsx';
import { startBackgroundScene } from './city/backgroundScene.js';
import { reportWebGLUnavailable } from './clientErrorLog.js';

/** Set showSettings=false when embedding the scene as a clean background. */
export function CityBackground({ className = '', showSettings = true, fixed = false }) {
  const container = useRef(null);
  const city = useRef(null);
  const [settings, setSettings] = useState(loadSettings);
  const initialSettings = useRef(settings);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    city.current = startBackgroundScene(container.current, initialSettings.current, {
      createScene: createCity,
      onFallback: () => setFailed(true),
      onUnavailable: () => reportWebGLUnavailable('city-background'),
      onError: error => console.error('Unable to start the city background', error),
    });
    return () => { city.current?.dispose(); city.current = null; };
  }, []);

  useEffect(() => {
    city.current?.updateSettings(settings);
    const timer = setTimeout(() => saveSettings(settings), 200);
    return () => clearTimeout(timer);
  }, [settings]);

  return (
    <div className={`city-background ${failed ? 'is-static-fallback' : ''} ${fixed ? 'is-fixed' : ''} ${className}`}>
      <div className="city-canvas" ref={container} role="img" aria-label={failed ? 'Static city background. 3D is unavailable in this browser.' : 'An endless low-poly city with trees, gray buildings, and yellow taxis in motion'} />
      {failed && <p className="city-error">3D unavailable. A static background is shown.</p>}
      {showSettings && <SettingsPanel settings={settings} onChange={setSettings} />}
    </div>
  );
}
