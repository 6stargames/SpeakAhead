/**
 * Detect and escape a stale build.
 *
 * A service worker that has cached the application shell will keep serving the
 * previous build until it decides to update, and it can decide not to for a
 * long time. Across this project's deployment history that produced hours of
 * confusion: fixes were live on the origin while the browser — mine and the
 * user's — carried on running the bundle from two deploys earlier, so a working
 * fix looked broken and got "fixed" again.
 *
 * A communication aid should never be stuck on an old build because a cache
 * would rather not check. So the page asks the origin directly, over a path no
 * worker intercepts, and if it is behind it clears the workers and reloads
 * exactly once.
 */

const ATTEMPT_KEY = 'aac.build-reload';

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export interface FreshnessResult {
  readonly current: boolean;
  readonly running: string | null;
  readonly expected: string | null;
  readonly reloaded: boolean;
}

/**
 * @param runningAsset the URL of the currently executing bundle, normally
 *   `import.meta.url`.
 */
export async function ensureCurrentBuild(runningAsset: string): Promise<FreshnessResult> {
  const running = fileName(runningAsset.split('?')[0] ?? runningAsset);

  let expected: string | null = null;
  try {
    const response = await fetch('/api/build', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return { current: true, running, expected: null, reloaded: false };
    expected = ((await response.json()) as { asset?: string }).asset ?? null;
  } catch {
    // Offline, or an origin without the endpoint. Keep what we have: a stale
    // build is far better than no build.
    return { current: true, running, expected: null, reloaded: false };
  }

  if (!expected) return { current: true, running, expected, reloaded: false };

  const wanted = fileName(expected);
  if (wanted === running) {
    try {
      sessionStorage.removeItem(ATTEMPT_KEY);
    } catch {
      /* Storage may be unavailable; the check still works without it. */
    }
    return { current: true, running, expected: wanted, reloaded: false };
  }

  // Reload at most once per build, so a mismatch we cannot fix — a proxy
  // serving something odd — degrades to a stale page rather than a reload loop.
  try {
    if (sessionStorage.getItem(ATTEMPT_KEY) === wanted) {
      console.warn(`[aac] Still running ${running}; the origin serves ${wanted}. Not reloading again.`);
      return { current: false, running, expected: wanted, reloaded: false };
    }
    sessionStorage.setItem(ATTEMPT_KEY, wanted);
  } catch {
    return { current: false, running, expected: wanted, reloaded: false };
  }

  console.info(`[aac] Running ${running} but the origin serves ${wanted}. Clearing workers and reloading.`);

  // Unregister rather than merely update: an worker that will not update is
  // precisely the situation being escaped. Cached models are untouched — they
  // live in the Cache API, which outlives the registration.
  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      await registration.unregister();
    }
  } catch {
    /* No worker to clear. */
  }

  location.reload();
  return { current: false, running, expected: wanted, reloaded: true };
}
