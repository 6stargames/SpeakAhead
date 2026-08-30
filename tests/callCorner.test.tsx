import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CallCorner } from '@/components/CallCorner';
import { store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.reset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('New call theme colour', () => {
  it('uses an ambient high-contrast background from the selected theme', () => {
    act(() => root.render(<CallCorner symbolTheme="halo-3" />));

    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.includes('New call'));
    expect(button?.style.background).toContain('linear-gradient');
    expect(button?.style.color).toBe('rgb(255, 255, 255)');
    expect(button?.classList.contains('call-corner__new-call')).toBe(true);
  });
});
