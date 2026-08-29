'use client';

import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { ensureCurrentBuild } from '@/lib/freshness';

export function PwaRegistration() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    void ensureCurrentBuild(import.meta.url);
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
