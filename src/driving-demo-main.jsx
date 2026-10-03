import React from 'react';
import { createRoot } from 'react-dom/client';
import './clientErrorLog.js';
import { DrivingDemo } from './driving-demo.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><DrivingDemo /></React.StrictMode>,
);
