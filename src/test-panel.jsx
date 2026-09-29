import React from 'react';
import { createRoot } from 'react-dom/client';
import { TaxiDashboard } from './TaxiDashboard.jsx';
import { TokenConfigProvider } from './tokenConfig.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TokenConfigProvider><TaxiDashboard simple /></TokenConfigProvider>
  </React.StrictMode>,
);
