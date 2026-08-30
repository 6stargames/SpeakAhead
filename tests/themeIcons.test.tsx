import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetThemedSymbolMemoryForTests,
  themeTileFor,
  useThemedSymbols,
} from '@/assist/themeIcons';
import type { ThemeIconRequestItem } from '@/assist/types';

let container: HTMLDivElement;
let root: Root;

function Harness({ items }: { items: readonly ThemeIconRequestItem[] }) {
  const tiles = useThemedSymbols(items, 'baby-shark');
  return <div data-count={items.filter((item) => themeTileFor(tiles, item)).length} />;
}

function pngResponse(index = 0): Response {
  return new Response(new Uint8Array(256), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'x-aac-sprite-columns': '3',
      'x-aac-sprite-rows': '3',
      'x-aac-sprite-index': String(index),
    },
  });
}

function isLookup(init?: RequestInit): boolean {
  if (init?.method !== 'POST' || typeof init.body !== 'string') return false;
  return (JSON.parse(init.body) as { lookupOnly?: boolean }).lookupOnly === true;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetThemedSymbolMemoryForTests();
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
  resetThemedSymbolMemoryForTests();
  vi.unstubAllGlobals();
});

describe('themed image reuse', () => {
  it('reuses an already loaded word picture when that item later appears in Favs', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      isLookup(init) ? Response.json({ groups: [] }) : pngResponse(),
    );
    vi.stubGlobal('fetch', fetchMock);
    const items = [
      { text: 'unique-favourite-water', symbol: '💧' },
      { text: 'unique-favourite-help', symbol: '🆘' },
    ];

    act(() => root.render(<Harness items={items} />));
    await flush();
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('2');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    act(() => root.render(<Harness items={[items[0]!]} />));
    await flush();
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the same picture when the normalized text returns with a different emoji', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      isLookup(init) ? Response.json({ groups: [] }) : pngResponse(),
    );
    vi.stubGlobal('fetch', fetchMock);

    act(() => root.render(<Harness items={[{ text: 'Tell me!', symbol: '🗣️' }]} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => root.render(<Harness items={[{ text: 'tell me', symbol: '💬' }]} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('restores a prior signed-in image after a fresh app session without generating again', async () => {
    let generated = false;
    let generationRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) {
        return Response.json({
          groups: generated
            ? [{
              probeText: 'Reusable phrase.',
              columns: 3,
              rows: 3,
              tiles: [{ requestIndex: 0, index: 4 }],
            }]
            : [],
        });
      }
      if (init?.method === 'POST') {
        generated = true;
        generationRequests += 1;
        return pngResponse();
      }
      expect(String(input)).toContain('text=Reusable+phrase.');
      return pngResponse(4);
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = [{ text: 'Reusable phrase.', symbol: '💬' }];

    act(() => root.render(<Harness key="first" items={items} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(generationRequests).toBe(1);

    resetThemedSymbolMemoryForTests();
    act(() => root.render(<Harness key="fresh-session" items={items} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(generationRequests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
