import { afterEach, beforeEach } from 'vitest';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// React 19 requires this flag before `act` will flush effects.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  delete (document as unknown as { modelContext?: unknown }).modelContext;
});
