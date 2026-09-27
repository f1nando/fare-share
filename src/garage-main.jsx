import React from 'react';
import { createRoot } from 'react-dom/client';
import { GaragePage } from './GaragePage.jsx';
import './fare-share.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GaragePage />
  </React.StrictMode>,
);
