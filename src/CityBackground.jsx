import { useEffect, useRef, useState } from 'react';
import { createCity } from './city/createCity.js';

/** Mount in any sized container; the scene needs no API, assets or user input. */
export function CityBackground({ className = '' }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      return createCity(container.current);
    } catch (error) {
      console.error('Unable to start the city background', error);
      setFailed(true);
    }
  }, []);

  return (
    <div className={`city-background ${className}`} ref={container} role="img" aria-label="Бесконечный лоу-поли город: деревья, белые домики и жёлтые такси в движении">
      {failed && <p className="city-error">Для отображения города нужен браузер с поддержкой WebGL 2.</p>}
    </div>
  );
}
