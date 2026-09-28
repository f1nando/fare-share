import React from 'react';
import { createRoot } from 'react-dom/client';
import { TradePage } from './TradePage.jsx';
import './fare-share.css';
import './trade.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TradePage />
  </React.StrictMode>,
);
