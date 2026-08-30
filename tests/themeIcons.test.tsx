import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetThemedSymbolMemoryForTests,
  themeTileFor,
  usePreparedSymbolTheme,
  useThemedSymbols,
} from '@/assist/themeIcons';
import type { ThemePreparationGroup } from '@/assist/themeIcons';
import type { ThemeIconRequestItem } from '@/assist/types';
import { actions, store } from '@/state/store';

let container: HTMLDivElement;
let root: Root;

function Harness({
  items,
  batchSize,
}: {
  items: readonly ThemeIconRequestItem[];
  batchSize?: number;
}) {
  const tiles = useThemedSymbols(items, 'baby-shark', { batchSize });
  return <div data-count={items.filter((item) => themeTileFor(tiles, item)).length} />;
}

function PreparedThemeHarness({ groups }: { groups: readonly ThemePreparationGroup[] }) {
  const theme = usePreparedSymbolTheme('baby-shark', groups);
  return <div data-theme={theme} />;
}

function pngResponse(index = 0, source: 'saved' | 'generated' = 'generated'): Response {
  return new Response(new Uint8Array(256), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'x-aac-sprite-columns': '3',
      'x-aac-sprite-rows': '3',
      'x-aac-sprite-index': String(index),
      'x-aac-image-source': source,
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
  store.reset();
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
  it('applies the selected theme immediately while every surface prepares', async () => {
    const generationResolvers: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) return Response.json({ groups: [] });
      return await new Promise<Response>((resolve) => generationResolvers.push(resolve));
    });
    vi.stubGlobal('fetch', fetchMock);
    const groups = [
      { items: [{ text: 'prepared-spine', symbol: '⭐' }] },
      { items: [{ text: 'prepared-board', symbol: '💬' }] },
    ];

    act(() => root.render(<PreparedThemeHarness groups={groups} />));
    await vi.waitFor(() => expect(generationResolvers).toHaveLength(2));
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('baby-shark');

    generationResolvers[0]!(pngResponse());
    await flush();
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('baby-shark');

    generationResolvers[1]!(pngResponse());
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-theme')).toBe('baby-shark');
    });
  });

  it('prepares independent batches concurrently and reveals each as it finishes', async () => {
    const generationResolvers: ((response: Response) => void)[] = [];
    let generationRequests = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) return Response.json({ groups: [] });
      generationRequests += 1;
      return await new Promise<Response>((resolve) => generationResolvers.push(resolve));
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = Array.from({ length: 10 }, (_, index) => ({
      text: `parallel-${index}`,
      symbol: '✨',
    }));

    act(() => root.render(<Harness items={items} batchSize={9} />));
    await vi.waitFor(() => expect(generationRequests).toBe(2));
    expect(container.firstElementChild?.getAttribute('data-count')).toBe('0');

    generationResolvers[0]!(pngResponse());
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('9');
    });

    generationResolvers[1]!(pngResponse());
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('10');
    });
  });

  it('marks only admitted generation slots active and leaves the rest waiting', async () => {
    const generationResolvers: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) return Response.json({ groups: [] });
      return await new Promise<Response>((resolve) => generationResolvers.push(resolve));
    });
    vi.stubGlobal('fetch', fetchMock);
    const groups = Array.from({ length: 4 }, (_, index) => [{
      text: `queued-slot-${index}`,
      symbol: '✨',
    }]);

    act(() => root.render(<>{groups.map((items, index) => (
      <Harness key={index} items={items} batchSize={1} />
    ))}</>));

    await vi.waitFor(() => expect(generationResolvers).toHaveLength(3));
    expect(store.getState().assistFeatures.themes.activeTasks).toBe(3);
    expect(store.getState().assistFeatures.themes.tasks.filter((task) => (
      task.status === 'queued'
    ))).toHaveLength(1);

    generationResolvers[0]!(pngResponse());
    await vi.waitFor(() => expect(generationResolvers).toHaveLength(4));
    expect(store.getState().assistFeatures.themes.activeTasks).toBe(3);
    expect(store.getState().assistFeatures.themes.tasks.filter((task) => (
      task.status === 'queued'
    ))).toHaveLength(0);

    generationResolvers.slice(1).forEach((resolve) => resolve(pngResponse()));
    await vi.waitFor(() => {
      expect(store.getState().assistFeatures.themes.activeTasks).toBe(0);
    });
  });

  it('requests functional controls as isolated themed glyphs', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return isLookup(init) ? Response.json({ groups: [] }) : pngResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const item = {
      text: 'Voice',
      symbol: '🎙️',
      presentation: 'control-icon' as const,
    };

    act(() => root.render(<Harness items={[item]} batchSize={1} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        presentation: 'control-icon',
        singleSubject: false,
        audienceGender: 'neutral',
      }),
    ]));
  });

  it('regenerates interface art for the selected gender but reuses ordinary word art', async () => {
    const generatedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) return Response.json({ groups: [] });
      if (init?.method === 'POST' && typeof init.body === 'string') {
        generatedBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return pngResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const control = { text: 'Settings', symbol: '⚙️', presentation: 'control-icon' as const };
    const word = { text: 'water', symbol: '💧' };

    act(() => root.render(<><Harness items={[control]} batchSize={1} /><Harness items={[word]} /></>));
    await vi.waitFor(() => expect(generatedBodies).toHaveLength(2));

    act(() => actions.setSettings({ voiceGender: 'male' }));
    await vi.waitFor(() => expect(generatedBodies).toHaveLength(3));

    expect(generatedBodies.map((body) => ({
      text: (body.items as ThemeIconRequestItem[])[0]?.text,
      audienceGender: body.audienceGender,
    }))).toEqual([
      { text: 'Settings', audienceGender: 'neutral' },
      { text: 'water', audienceGender: 'neutral' },
      { text: 'Settings', audienceGender: 'male' },
    ]);
  });

  it('restores saved pictures silently even when two surfaces ask at once', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) {
        return Response.json({
          groups: [{
            probeText: 'cached-water',
            columns: 3,
            rows: 3,
            tiles: [{ requestIndex: 0, index: 2 }],
          }],
        });
      }
      expect(String(input)).toContain('text=cached-water');
      return pngResponse(2, 'saved');
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = [{ text: 'cached-water', symbol: '💧' }];

    act(() => root.render(<><Harness items={items} /><Harness items={items} /></>));
    await vi.waitFor(() => {
      expect([...container.children].every((element) => element.getAttribute('data-count') === '1')).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().assistFeatures.themes.tasks).toHaveLength(0);
  });

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
    expect(store.getState().assistFeatures.themes.tasks).toHaveLength(1);

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

  it('never generates shared and private choices in the same sprite sheet', async () => {
    const generatedBatches: ThemeIconRequestItem[][] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) return Response.json({ groups: [] });
      if (init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as { items: ThemeIconRequestItem[] };
        generatedBatches.push(body.items);
      }
      return pngResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = [
      { text: 'pizza', symbol: '🍕' },
      { text: 'Please call Danny.', symbol: '📞' },
    ];

    act(() => root.render(<Harness items={items} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('2');
    });
    expect(generatedBatches).toEqual([
      [{ text: 'pizza', symbol: '🍕' }],
      [{ text: 'Please call Danny.', symbol: '📞' }],
    ]);
  });

  it('refreshes the library when another user is already generating the image', async () => {
    let lookupCount = 0;
    let generationRequests = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (isLookup(init)) {
        lookupCount += 1;
        return Response.json({
          groups: lookupCount > 1
            ? [{
              probeText: 'pizza',
              columns: 3,
              rows: 3,
              tiles: [{ requestIndex: 0, index: 2 }],
            }]
            : [],
        });
      }
      if (init?.method === 'POST') {
        generationRequests += 1;
        return Response.json(
          { error: 'image_cache_refresh' },
          {
            status: 409,
            headers: {
              'retry-after': '0.001',
              'x-aac-cache-refresh': 'true',
            },
          },
        );
      }
      return pngResponse(2);
    });
    vi.stubGlobal('fetch', fetchMock);

    act(() => root.render(<Harness items={[{ text: 'pizza', symbol: '🍕' }]} />));
    await vi.waitFor(() => {
      expect(container.firstElementChild?.getAttribute('data-count')).toBe('1');
    });
    expect(generationRequests).toBe(1);
    expect(lookupCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
