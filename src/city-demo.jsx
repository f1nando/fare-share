import React from 'react';
import { createRoot } from 'react-dom/client';
import './clientErrorLog.js';
import { CityBackground } from './CityBackground.jsx';
import './style.css';

if (new URLSearchParams(location.search).get('benchmark') === '1') {
  import('./city/performanceBenchmark.js').then(({ startBenchmark }) => startBenchmark(document.getElementById('root')));
} else {
  createRoot(document.getElementById('root')).render(<React.StrictMode><CityBackground /></React.StrictMode>);
}
