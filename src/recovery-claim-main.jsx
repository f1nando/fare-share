import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecoveryClaimPage } from './RecoveryClaimPage.jsx';
import './recovery-claim.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><RecoveryClaimPage /></React.StrictMode>,
);
