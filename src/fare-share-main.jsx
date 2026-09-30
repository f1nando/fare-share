import React from 'react';
import { createRoot } from 'react-dom/client';
import './clientErrorLog.js';
import { FareShareApp } from './FareShareApp.jsx';
import './fare-share.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FareShareApp />
  </React.StrictMode>,
);
