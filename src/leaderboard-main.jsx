import React from 'react';
import { createRoot } from 'react-dom/client';
import { LeaderboardPage } from './LeaderboardPage.jsx';
import './fare-share.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LeaderboardPage />
  </React.StrictMode>,
);
