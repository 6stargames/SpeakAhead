import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import type { ThemeIconRequestItem, ThemeSprite } from './types';

export interface ThemeTile extends ThemeSprite {
  readonly index: number;
}

const memory = new Map<string, Promise<ThemeSprite | null>>();
let queue: Promise<unknown> = Promise.resolve();

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

function isSprite(value: unknown): value is ThemeSprite {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.imageDataUrl === 'string' &&
    record.imageDataUrl.startsWith('data:image/png;base64,') &&
    record.imageDataUrl.length > 100 &&
    Number.isInteger(record.columns) &&
    Number(record.columns) > 0 &&
    Number.isInteger(record.rows) &&
    Number(record.rows) > 0
  );
}

async function readCached(cacheKey: string): Promise<ThemeSprite | null> {
  if (!('caches' in globalThis) || typeof location === 'undefined') return null;
  try {
    const cache = await caches.open('aac-themed-symbols-v1');
    const request = new Request(new URL(`/__aac-theme-cache/${cacheKey}`, location.href));
    const response = await cache.match(request);
    if (!response) return null;
    const value = await response.json();
    return isSprite(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeCached(cacheKey: string, sprite: ThemeSprite): Promise<void> {
  if (!('caches' in globalThis) || typeof location === 'undefined') return;
  try {
    const cache = await caches.open('aac-themed-symbols-v1');
    const request = new Request(new URL(`/__aac-theme-cache/${cacheKey}`, location.href));
    await cache.put(
      request,
      new Response(JSON.stringify(sprite), { headers: { 'content-type': 'application/json' } }),
    );
  } catch {
    /* A theme is cosmetic. Storage pressure must never affect communication. */
  }
}

async function requestSprite(items: readonly ThemeIconRequestItem[]): Promise<ThemeSprite | null> {
  try {
    const response = await fetch('/api/assist/theme-icons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ theme: 'anime', items }),
    });
    if (!response.ok) return null;
    const value = await response.json();
    return isSprite(value) ? value : null;
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
    const cached = await readCached(cacheKey);
    if (cached) return cached;
    const sprite = await requestSprite(items);
    if (sprite) await writeCached(cacheKey, sprite);
    return sprite;
  });
  memory.set(cacheKey, promise);
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
        const sprite = await loadSprite(group);
        if (cancelled) return;
        if (!sprite) continue;
        group.forEach((item, index) => next.set(itemKey(item), { ...sprite, index }));
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
    backgroundImage: `url(${JSON.stringify(tile.imageDataUrl)})`,
    backgroundSize: `${tile.columns * 100}% ${tile.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
  return <span className="cell__symbol cell__symbol--themed" style={style} aria-hidden="true" />;
}

