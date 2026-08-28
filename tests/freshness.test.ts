import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureCurrentBuild } from '@/lib/freshness';

/**
 * Guards the escape hatch from a stale service worker, which cost this project
 * hours: fixes were live on the origin while the browser ran a bundle from two
 * deploys earlier, so working code looked broken and got "fixed" again.
 */

const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
  Object.defineProperty(globalThis, 'location', {
    value: { reload, href: 'https://example.test/' },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: { getRegistrations: async () => [] },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function originServes(asset: string | null, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => ({ asset }) })));
}

describe('ensureCurrentBuild', () => {
  it('does nothing when the running build matches the origin', async () => {
    originServes('/assets/index-AAA.js');
    const result = await ensureCurrentBuild('https://example.test/assets/index-AAA.js');

    expect(result.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears workers and reloads when the build is behind', async () => {
    const unregister = vi.fn(async () => true);
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { getRegistrations: async () => [{ unregister }] },
      writable: true,
      configurable: true,
    });
    originServes('/assets/index-NEW.js');

    await ensureCurrentBuild('https://example.test/assets/index-OLD.js');

    expect(unregister).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at most once per build, so a mismatch cannot loop', async () => {
    originServes('/assets/index-NEW.js');

    await ensureCurrentBuild('https://example.test/assets/index-OLD.js');
    expect(reload).toHaveBeenCalledTimes(1);

    // Second pass: the reload did not help, so stop rather than loop forever.
    const second = await ensureCurrentBuild('https://example.test/assets/index-OLD.js');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.current).toBe(false);
    expect(second.reloaded).toBe(false);
  });

  it('keeps the running build when the origin cannot be reached', async () => {
    // Offline. A stale build is far better than no build.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const result = await ensureCurrentBuild('https://example.test/assets/index-OLD.js');

    expect(result.current).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the running build when the endpoint is absent', async () => {
    originServes(null, false);
    await ensureCurrentBuild('https://example.test/assets/index-OLD.js');
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the attempt marker once the build is current again', async () => {
    originServes('/assets/index-NEW.js');
    await ensureCurrentBuild('https://example.test/assets/index-OLD.js');
    expect(sessionStorage.getItem('aac.build-reload')).toBe('index-NEW.js');

    originServes('/assets/index-NEW.js');
    await ensureCurrentBuild('https://example.test/assets/index-NEW.js');
    expect(sessionStorage.getItem('aac.build-reload')).toBeNull();
  });
});
