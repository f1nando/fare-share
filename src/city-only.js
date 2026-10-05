import { createCity } from './city/createCity.js';
import { loadSettings } from './city/settings.js';
import './city-only.css';

const city = createCity(document.getElementById('city'), {
  ...loadSettings(),
  colorScheme: 'classic',
  paused: false,
});

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) city.dispose();
});
