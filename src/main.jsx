import React from 'react';
import { createRoot } from 'react-dom/client';
import { CityBackground } from './CityBackground.jsx';
import { TaxiDashboard } from './TaxiDashboard.jsx';
import './style.css';

if (new URLSearchParams(location.search).get('benchmark') === '1') {
  import('./city/performanceBenchmark.js').then(({ startBenchmark }) => startBenchmark(document.getElementById('root')));
} else createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get('city') === '1'
      ? <CityBackground />
      : <TaxiDashboard background={<CityBackground fixed showSettings={false} />} />}
  </React.StrictMode>,
);
