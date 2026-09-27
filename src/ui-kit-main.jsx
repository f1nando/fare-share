import React from 'react';
import { createRoot } from 'react-dom/client';
import { UIKitPage } from './UIKitPage.jsx';
import './fare-share.css';
import './ui-kit.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UIKitPage />
  </React.StrictMode>,
);
