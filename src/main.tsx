import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { ensureCurrentBuild } from './lib/freshness';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing from the document.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Offline independence.
 *
 * The service worker precaches the shell and runtime-caches model weights, so
 * the device keeps working with the network severed - which is the point.
 *
 * Updates are deliberately quiet. The worker is built with `skipWaiting`, so a
 * new one activates the moment it is found and the next navigation gets the new
 * shell. The running page is never reloaded underneath its user: an AAC device
 * must not interrupt someone mid-sentence, and it must not put a dialogue about
 * versions in front of someone who is trying to speak.
 */
if (import.meta.env.PROD) {
  // Before trusting the worker, check the origin directly. A worker serving a
  // stale shell will never volunteer that it is behind.
  void ensureCurrentBuild(import.meta.url);

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      // Check hourly. Frequent enough to pick up fixes, rare enough to stay out
      // of the way on a metered connection.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
    onNeedRefresh() {
      // A new version is installed and already active. Say so in the console
      // and let the next navigation pick it up.
      console.info('[aac] A new version is ready and will be used on the next load.');
    },
    onRegisterError(error) {
      console.warn('[aac] Service worker registration failed; offline support is unavailable.', error);
    },
  });
}
