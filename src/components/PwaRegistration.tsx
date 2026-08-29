'use client';

import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function PwaRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    // Do not call the legacy Firebase freshness endpoint here. This component
    // is bundled as a Vinext chunk on Sites, while `/api/build` belongs to the
    // original Firebase deployment and reports its Vite `index-*.js` asset.
    // Comparing those unrelated filenames makes every Sites build look stale
    // and can trigger an unnecessary reload. The service worker's own update
    // check below is the source of truth for this deployment.
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (registration) {
          window.setInterval(() => void registration.update(), 60 * 60 * 1000);
        }
      },
      onNeedRefresh() {
        console.info('[aac] A new version is ready and will be used on the next load.');
      },
      onRegisterError(error) {
        console.warn('[aac] Service worker registration failed; offline support is unavailable.', error);
      },
    });
  }, []);

  return null;
}
