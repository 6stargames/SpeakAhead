import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { actions } from '@/state/store';
import type { ThemeIconRequestItem, ThemeSprite } from './types';
import { waitForCommunicationIdle } from './communicationPriority';

export interface ThemeTile extends ThemeSprite {
  readonly index: number;
}

const memory = new Map<string, Promise<ThemeSprite | null>>();
let queue: Promise<unknown> = Promise.resolve();
const CACHE_NAME = 'aac-themed-symbols-v2';
const COLUMNS_HEADER = 'x-aac-sprite-columns';
const ROWS_HEADER = 'x-aac-sprite-rows';

function itemKey(item: ThemeIconRequestItem): string {
  return `${item.symbol}\u0000${item.text}`;
}

function hash(value: string): string {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return (state >>> 0).toString(36);
}

function dimension(response: Response, header: string): number | null {
  const value = Number(response.headers.get(header));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function spriteFromBlob(blob: Blob, columns: number, rows: number): ThemeSprite | null {
  if (blob.size <= 100 || !blob.type.startsWith('image/png') || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  return { imageUrl: URL.createObjectURL(blob), columns, rows };
}

async function readCached(cacheKey: string): Promise<ThemeSprite | null> {
  if (!('caches' in globalThis) || typeof location === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const request = new Request(new URL(`/__aac-theme-cache/${cacheKey}`, location.href));
    const response = await cache.match(request);
    if (!response) return null;
    const columns = dimension(response, COLUMNS_HEADER);
    const rows = dimension(response, ROWS_HEADER);
    if (!columns || !rows) return null;
    const blob = await response.blob();
    return spriteFromBlob(blob, columns, rows);
  } catch {
    return null;
  }
}

async function writeCached(
  cacheKey: string,
  blob: Blob,
  columns: number,
  rows: number,
): Promise<void> {
  if (!('caches' in globalThis) || typeof location === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const request = new Request(new URL(`/__aac-theme-cache/${cacheKey}`, location.href));
    await cache.put(
      request,
      new Response(blob, {
        headers: {
          'content-type': 'image/png',
          [COLUMNS_HEADER]: String(columns),
          [ROWS_HEADER]: String(rows),
        },
      }),
    );
  } catch {
    /* A theme is cosmetic. Storage pressure must never affect communication. */
  }
}

interface SpritePayload {
  readonly blob: Blob;
  readonly columns: number;
  readonly rows: number;
}

async function requestSprite(items: readonly ThemeIconRequestItem[]): Promise<SpritePayload | null> {
  try {
    const response = await fetch('/api/assist/theme-icons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/png' },
      credentials: 'same-origin',
      body: JSON.stringify({ theme: 'anime', items }),
    });
    if (!response.ok) return null;
    const columns = dimension(response, COLUMNS_HEADER);
    const rows = dimension(response, ROWS_HEADER);
    if (!columns || !rows || !response.headers.get('content-type')?.startsWith('image/png')) return null;

    // Fetch resolves once headers arrive. Wait for a quiet spell before the
    // large response body is materialised in the browser process.
    await waitForCommunicationIdle();
    const blob = await response.blob();
    return blob.size > 100 ? { blob, columns, rows } : null;
  } catch {
    return null;
  }
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const task = queue.then(work, work);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function loadSprite(items: readonly ThemeIconRequestItem[]): Promise<ThemeSprite | null> {
  const cacheKey = hash(`anime\u0001${items.map(itemKey).join('\u0002')}`);
  const existing = memory.get(cacheKey);
  if (existing) return existing;

  const promise = enqueue(async () => {
    await waitForCommunicationIdle();
    const cached = await readCached(cacheKey);
    if (cached) return cached;
    const payload = await requestSprite(items);
    if (!payload) return null;
    await waitForCommunicationIdle();
    const sprite = spriteFromBlob(payload.blob, payload.columns, payload.rows);
    if (!sprite) return null;
    await writeCached(cacheKey, payload.blob, payload.columns, payload.rows);
    return sprite;
  });
  memory.set(cacheKey, promise);
  void promise.then((sprite) => {
    if (!sprite) memory.delete(cacheKey);
  });
  return promise;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** Generate and cache one 3x3 image sheet at a time, keeping model traffic low. */
export function useThemedSymbols(
  items: readonly ThemeIconRequestItem[],
  enabled: boolean,
): ReadonlyMap<string, ThemeTile> {
  const signature = useMemo(() => items.map(itemKey).join('\u0002'), [items]);
  const stableItems = useMemo(() => items.map((item) => ({ ...item })), [signature]);
  const [tiles, setTiles] = useState<ReadonlyMap<string, ThemeTile>>(new Map());

  useEffect(() => {
    if (!enabled || stableItems.length === 0) {
      setTiles(new Map());
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, ThemeTile>();
      for (const group of chunk(stableItems, 9)) {
        actions.beginAssistTask('themes');
        const sprite = await loadSprite(group);
        if (!sprite) {
          actions.finishAssistTask('themes', 'unavailable', next.size);
          if (cancelled) return;
          continue;
        }
        group.forEach((item, index) => next.set(itemKey(item), { ...sprite, index }));
        actions.finishAssistTask('themes', 'ready', next.size);
        if (cancelled) return;
        // Publish each completed sheet so the first nine icons do not wait for
        // an entire board to finish generating.
        setTiles(new Map(next));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, stableItems]);

  return tiles;
}

export function themeTileFor(
  tiles: ReadonlyMap<string, ThemeTile>,
  item: ThemeIconRequestItem,
): ThemeTile | undefined {
  return tiles.get(itemKey(item));
}

export function ThemedSymbol({
  symbol,
  tile,
}: {
  symbol: string;
  tile?: ThemeTile;
}): JSX.Element {
  if (!tile) return <span className="cell__symbol" aria-hidden="true">{symbol}</span>;
  const column = tile.index % tile.columns;
  const row = Math.floor(tile.index / tile.columns);
  const x = tile.columns <= 1 ? 0 : (column / (tile.columns - 1)) * 100;
  const y = tile.rows <= 1 ? 0 : (row / (tile.rows - 1)) * 100;
  const style: CSSProperties = {
    backgroundImage: `url(${JSON.stringify(tile.imageUrl)})`,
    backgroundSize: `${tile.columns * 100}% ${tile.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
  return <span className="cell__symbol cell__symbol--themed" style={style} aria-hidden="true" />;
}
