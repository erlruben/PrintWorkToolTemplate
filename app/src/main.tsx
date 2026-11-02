import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './lib/session';
import { isDemo } from './lib/supabase';
import App from './App';
import './styles.css';
import './refresh.css';

const previewOnly = import.meta.env.DEV && new URLSearchParams(window.location.search).get('login') !== '1' && !isDemo;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {previewOnly ? (
      <App />
    ) : (
      <SessionProvider>
        <App />
      </SessionProvider>
    )}
  </StrictMode>,
);

// Register the service worker so the app can be installed to a home screen.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
