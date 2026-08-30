import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themeTileFor, useThemedSymbols } from '@/assist/themeIcons';
import type { ThemeIconRequestItem } from '@/assist/types';

let container: HTMLDivElement;
let root: Root;

function Harness({ items }: { items: readonly ThemeIconRequestItem[] }) {
  const tiles = useThemedSymbols(items, 'baby-shark');
  return <div data-count={items.filter((item) => themeTileFor(tiles, item)).length} />;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:themed-icon'),
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('themed image reuse', () => {
  it('reuses an already loaded word picture when that item later appears in Favs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array(256), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'x-aac-sprite-columns': '3',
          'x-aac-sprite-rows': '3',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const items = [
      { text: 'unique-favourite-water', symbol: '💧' },
      { text: 'unique-favourite-help', symbol: '🆘' },
    ];

    act(() => root.render(<Harness items={items} />));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('2');
    });

    act(() => root.render(<Harness items={[items[0]!]} />));
    await flush();
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
