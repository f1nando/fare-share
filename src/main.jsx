import React from 'react';
import { createRoot } from 'react-dom/client';
import { CityBackground } from './CityBackground.jsx';
import './style.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CityBackground />
  </React.StrictMode>,
);
