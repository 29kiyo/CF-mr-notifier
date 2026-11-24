import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { consumeAuthHash } from './lib.js';
import './styles.css';

consumeAuthHash();
if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
