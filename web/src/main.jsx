import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import { UiProvider } from './components/ui.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Service worker: aplikacioni hapet edhe pa internet (vetëm në versionin e publikuar).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`/sw.js?v=${__BUILD_ID__}`).catch(() => {}); });
}
