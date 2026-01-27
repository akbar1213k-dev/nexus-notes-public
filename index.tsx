import { Buffer } from 'buffer';

// PENTING: Inisialisasi Buffer secara global untuk browser
// Ini mengatasi error "Buffer is not defined" secara permanen
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  (window as any).global = window;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // Import CSS file explicitly
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);