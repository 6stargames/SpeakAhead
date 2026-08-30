import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { actions } from '@/state/store';
import type { SymbolTheme } from '@/state/store';
import type { ThemeIconRequestItem, ThemeSprite } from './types';

export interface ThemeTile extends ThemeSprite {
  readonly index: number;
}

const memory = new Map<string, Promise<ThemeSprite | null>>();
const itemMemory = new Map<string, Promise<ThemeTile | null>>();
let queue: Promise<unknown> = Promise.resolve();
const CACHE_NAME = 'aac-themed-symbols-v4';
const COLUMNS_HEADER = 'x-aac-sprite-columns';
const ROWS_HEADER = 'x-aac-sprite-rows';

function itemKey(item: ThemeIconRequestItem): string {
  return `${item.symbol}\u0000${item.text}`;
}

function themedItemKey(
  theme: Exclude<SymbolTheme, 'emoji'>,
  item: ThemeIconRequestItem,
  singleSubject: boolean,
): string {
  return `${theme}\u0000${singleSubject ? 'single' : 'board'}\u0000${itemKey(item)}`;
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

async function requestSprite(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<SpritePayload | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/assist/theme-icons', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'image/png' },
        credentials: 'same-origin',
        body: JSON.stringify({ theme, items, singleSubject }),
      });
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(30_000, retryAfter * 1_000)
          : 12_000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) return null;
      const columns = dimension(response, COLUMNS_HEADER);
      const rows = dimension(response, ROWS_HEADER);
      if (!columns || !rows || !response.headers.get('content-type')?.startsWith('image/png')) return null;

      const blob = await response.blob();
      return blob.size > 100 ? { blob, columns, rows } : null;
    } catch {
      if (attempt === 2) return null;
    }
  }
  return null;
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const task = queue.then(work, work);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function loadSprite(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<ThemeSprite | null> {
  const cacheKey = hash(
    `${theme}\u0001${singleSubject ? 'single' : 'board'}\u0001${items.map(itemKey).join('\u0002')}`,
  );
  const existing = memory.get(cacheKey);
  if (existing) return existing;

  const promise = enqueue(async () => {
    const cached = await readCached(cacheKey);
    if (cached) return cached;
    const payload = await requestSprite(items, theme, singleSubject);
    if (!payload) return null;
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

async function loadTiles(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<ReadonlyMap<string, ThemeTile>> {
  const missing = items.filter((item) => !itemMemory.has(themedItemKey(theme, item, singleSubject)));
  if (missing.length > 0) {
    const spritePromise = loadSprite(missing, theme, singleSubject);
    missing.forEach((item, index) => {
      const key = themedItemKey(theme, item, singleSubject);
      const tilePromise = spritePromise.then((sprite) => (sprite ? { ...sprite, index } : null));
      itemMemory.set(key, tilePromise);
      void tilePromise.then((tile) => {
        if (!tile) itemMemory.delete(key);
      });
    });
  }

  const resolved = await Promise.all(
    items.map(async (item) => ({
      item,
      tile: await itemMemory.get(themedItemKey(theme, item, singleSubject)),
    })),
  );
  const result = new Map<string, ThemeTile>();
  resolved.forEach(({ item, tile }) => {
    if (tile) result.set(itemKey(item), tile);
  });
  return result;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** Generate and cache one 3x3 image sheet at a time, keeping model traffic low. */
export function useThemedSymbols(
  items: readonly ThemeIconRequestItem[],
  theme: SymbolTheme,
  options: { batchSize?: number; singleSubject?: boolean } = {},
): ReadonlyMap<string, ThemeTile> {
  const batchSize = Math.max(1, Math.min(9, options.batchSize ?? 9));
  const singleSubject = options.singleSubject === true;
  const signature = useMemo(() => items.map(itemKey).join('\u0002'), [items]);
  const stableItems = useMemo(() => items.map((item) => ({ ...item })), [signature]);
  const [tiles, setTiles] = useState<ReadonlyMap<string, ThemeTile>>(new Map());

  useEffect(() => {
    if (theme === 'emoji' || stableItems.length === 0) {
      setTiles(new Map());
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, ThemeTile>();
      for (const group of chunk(stableItems, batchSize)) {
        actions.beginAssistTask('themes');
        const groupTiles = await loadTiles(group, theme, singleSubject);
        if (groupTiles.size === 0) {
          actions.finishAssistTask('themes', 'unavailable', next.size);
          if (cancelled) return;
          continue;
        }
        groupTiles.forEach((tile, key) => next.set(key, tile));
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
  }, [batchSize, singleSubject, stableItems, theme]);

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
