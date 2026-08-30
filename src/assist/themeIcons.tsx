import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { actions } from '@/state/store';
import type { SymbolTheme } from '@/state/store';
import { normalizedChoice } from './choiceAvailability';
import { themeImageCacheScope } from './themeImageSharing';
import type { ThemeIconRequestItem, ThemeSprite } from './types';

export interface ThemeTile extends ThemeSprite {
  readonly index: number;
}

type ThemedKey = string;

interface SpritePayload {
  readonly blob: Blob;
  readonly columns: number;
  readonly rows: number;
  readonly index: number;
  readonly source: 'saved' | 'generated' | 'unknown';
}

interface SavedGroup {
  readonly probeText: string;
  readonly columns: number;
  readonly rows: number;
  readonly tiles: readonly { requestIndex: number; index: number }[];
}

type GenerationResult =
  | { readonly kind: 'image'; readonly payload: SpritePayload }
  | { readonly kind: 'refresh'; readonly retryAfterMs: number }
  | { readonly kind: 'unavailable' };

const itemMemory = new Map<ThemedKey, Promise<ThemeTile | null>>();
const resolvedMemory = new Map<ThemedKey, ThemeTile>();
// Saved pictures are always restored in parallel. New image generations use
// a small shared pool: enough concurrency for a theme to prepare quickly,
// without turning a theme switch into an unbounded burst of model requests.
const MAX_CONCURRENT_GENERATIONS = 3;
let activeGenerations = 0;
const generationWaiters: (() => void)[] = [];
const COLUMNS_HEADER = 'x-aac-sprite-columns';
const ROWS_HEADER = 'x-aac-sprite-rows';
const INDEX_HEADER = 'x-aac-sprite-index';
const SOURCE_HEADER = 'x-aac-image-source';
const INPUT_TOKENS_HEADER = 'x-aac-input-tokens';
const OUTPUT_TOKENS_HEADER = 'x-aac-output-tokens';
const TOTAL_TOKENS_HEADER = 'x-aac-total-tokens';

function itemKey(item: ThemeIconRequestItem): string {
  // The word's meaning owns the picture. A changing health/fallback emoji must
  // not disconnect the button from artwork already made for the same label.
  return normalizedChoice(item.text);
}

function themedItemKey(
  theme: Exclude<SymbolTheme, 'emoji'>,
  item: ThemeIconRequestItem,
  singleSubject: boolean,
): ThemedKey {
  // A button's meaning, rather than its fallback emoji or punctuation, owns
  // the picture. This is the same identity used by the signed-in R2 library.
  return `${theme}\u0000${singleSubject ? 'single' : 'board'}\u0000${normalizedChoice(item.text)}`;
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

async function imagePayload(response: Response): Promise<SpritePayload | null> {
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) return null;
  const columns = dimension(response, COLUMNS_HEADER);
  const rows = dimension(response, ROWS_HEADER);
  if (!columns || !rows) return null;
  const headerIndex = Number(response.headers.get(INDEX_HEADER));
  const index = Number.isInteger(headerIndex) && headerIndex >= 0 ? headerIndex : 0;
  const sourceHeader = response.headers.get(SOURCE_HEADER);
  const source = sourceHeader === 'saved' || sourceHeader === 'generated'
    ? sourceHeader
    : 'unknown';
  if (source === 'generated') {
    const tokenCount = (header: string) => {
      const value = Number(response.headers.get(header));
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    };
    actions.recordAssistUsage('image', {
      inputTokens: tokenCount(INPUT_TOKENS_HEADER),
      outputTokens: tokenCount(OUTPUT_TOKENS_HEADER),
      totalTokens: tokenCount(TOTAL_TOKENS_HEADER),
    });
  }
  const blob = await response.blob();
  return blob.size > 100 ? { blob, columns, rows, index, source } : null;
}

async function requestGeneratedSprite(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<GenerationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/assist/theme-icons', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'image/png' },
        credentials: 'same-origin',
        body: JSON.stringify({ theme, items, singleSubject }),
      });
      if (response.status === 409 && response.headers.get('x-aac-cache-refresh') === 'true') {
        const retryAfter = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        return {
          kind: 'refresh',
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(5_000, retryAfter * 1_000)
            : 2_000,
        };
      }
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(30_000, retryAfter * 1_000)
          : 12_000 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const payload = await imagePayload(response);
      return payload ? { kind: 'image', payload } : { kind: 'unavailable' };
    } catch {
      if (attempt === 2) return { kind: 'unavailable' };
    }
  }
  return { kind: 'unavailable' };
}

async function lookupSavedGroups(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<readonly SavedGroup[]> {
  try {
    const response = await fetch('/api/assist/theme-icons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ theme, items, singleSubject, lookupOnly: true }),
    });
    if (!response.ok) return [];
    const value = await response.json() as { groups?: unknown };
    if (!Array.isArray(value.groups)) return [];
    return value.groups.filter((group): group is SavedGroup => {
      if (!group || typeof group !== 'object') return false;
      const candidate = group as Partial<SavedGroup>;
      return typeof candidate.probeText === 'string' &&
        Number.isInteger(candidate.columns) && (candidate.columns ?? 0) > 0 &&
        Number.isInteger(candidate.rows) && (candidate.rows ?? 0) > 0 &&
        Array.isArray(candidate.tiles);
    });
  } catch {
    return [];
  }
}

async function requestSavedSprite(
  theme: Exclude<SymbolTheme, 'emoji'>,
  text: string,
  singleSubject: boolean,
): Promise<SpritePayload | null> {
  try {
    const params = new URLSearchParams({
      theme,
      text,
      singleSubject: String(singleSubject),
    });
    const response = await fetch(`/api/assist/theme-icons?${params.toString()}`, {
      credentials: 'same-origin',
      headers: { accept: 'image/png' },
    });
    return await imagePayload(response);
  } catch {
    return null;
  }
}

async function withGenerationSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    await new Promise<void>((resolve) => generationWaiters.push(resolve));
  }
  activeGenerations += 1;
  try {
    return await work();
  } finally {
    activeGenerations -= 1;
    generationWaiters.shift()?.();
  }
}

async function loadMissingTiles(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<ReadonlyMap<ThemedKey, ThemeTile>> {
  const result = new Map<ThemedKey, ThemeTile>();
  let missing = [...items];

  // A competing browser may be creating one of these choices. Recheck the
  // shared library after its short lease response instead of submitting a
  // second image request. Eight passes cover the normal generation window.
  for (let pass = 0; pass < 8 && missing.length > 0; pass += 1) {
    const groups = await lookupSavedGroups(missing, theme, singleSubject);

    // One saved sheet may contain several requested buttons. Fetch that sheet
    // once, then reconnect every matching button to its original cell.
    await Promise.all(groups.map(async (group) => {
      const payload = await requestSavedSprite(theme, group.probeText, singleSubject);
      if (!payload) return;
      const sprite = spriteFromBlob(payload.blob, group.columns, group.rows);
      if (!sprite) return;
      group.tiles.forEach(({ requestIndex, index }) => {
        const item = missing[requestIndex];
        if (!item || !Number.isInteger(index) || index < 0) return;
        result.set(themedItemKey(theme, item, singleSubject), { ...sprite, index });
      });
    }));

    missing = items.filter((item) => !result.has(themedItemKey(theme, item, singleSubject)));
    if (missing.length === 0) break;

    // Never place a private choice beside a shared one in the same downloaded
    // sprite sheet. The server independently enforces this boundary.
    const partitions = [
      missing.filter((item) => themeImageCacheScope(item.text) === 'shared'),
      missing.filter((item) => themeImageCacheScope(item.text) === 'private'),
    ].filter((partition) => partition.length > 0);

    let refreshDelay = 0;
    const generatedPartitions = await Promise.all(partitions.map(async (partition) => {
      const generated = await withGenerationSlot(async () => {
        const taskId = actions.beginAssistTask('themes', pictureTaskLabel(partition));
        const outcome = await requestGeneratedSprite(partition, theme, singleSubject);
        if (outcome.kind === 'image') {
          actions.finishAssistTask('themes', 'ready', partition.length, taskId);
        } else if (outcome.kind === 'refresh') {
          actions.finishAssistTask('themes', 'idle', 0, taskId);
        } else {
          actions.finishAssistTask('themes', 'unavailable', 0, taskId);
        }
        return outcome;
      });
      return { generated, partition };
    }));

    generatedPartitions.forEach(({ generated, partition }) => {
      if (generated.kind === 'refresh') {
        refreshDelay = Math.max(refreshDelay, generated.retryAfterMs);
        return;
      }
      if (generated.kind !== 'image') return;
      const sprite = spriteFromBlob(
        generated.payload.blob,
        generated.payload.columns,
        generated.payload.rows,
      );
      if (!sprite) return;
      partition.forEach((item, index) => {
        result.set(themedItemKey(theme, item, singleSubject), { ...sprite, index });
      });
    });

    missing = items.filter((item) => !result.has(themedItemKey(theme, item, singleSubject)));
    if (missing.length === 0 || refreshDelay === 0) break;
    await new Promise((resolve) => setTimeout(resolve, refreshDelay));
  }
  return result;
}

async function loadTiles(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
): Promise<ReadonlyMap<string, ThemeTile>> {
  const uniqueMissing = new Map<ThemedKey, ThemeIconRequestItem>();
  items.forEach((item) => {
    const key = themedItemKey(theme, item, singleSubject);
    if (!itemMemory.has(key)) uniqueMissing.set(key, item);
  });

  if (uniqueMissing.size > 0) {
    const missing = [...uniqueMissing.values()];
    // Register the shared promise immediately so overlapping prewarm and
    // visible-board hooks join the same restore/generation work.
    const groupPromise = loadMissingTiles(missing, theme, singleSubject);
    missing.forEach((item) => {
      const key = themedItemKey(theme, item, singleSubject);
      const tilePromise = groupPromise
        .then((tiles) => tiles.get(key) ?? null)
        .catch(() => null);
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
    if (tile) {
      resolvedMemory.set(themedItemKey(theme, item, singleSubject), tile);
      result.set(itemKey(item), tile);
    }
  });
  return result;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function pictureTaskLabel(items: readonly ThemeIconRequestItem[]): string {
  const names = items.slice(0, 4).map((item) => `“${item.text.trim()}”`).join(', ');
  const remainder = items.length > 4 ? ` and ${items.length - 4} more` : '';
  return `Pictures for ${names}${remainder}`;
}

/** Restore batches in parallel and publish one complete, coherent tile set. */
export function useThemedSymbols(
  items: readonly ThemeIconRequestItem[],
  theme: SymbolTheme,
  options: { batchSize?: number; singleSubject?: boolean } = {},
): ReadonlyMap<string, ThemeTile> {
  const batchSize = Math.max(1, Math.min(9, options.batchSize ?? 9));
  const singleSubject = options.singleSubject === true;
  const signature = useMemo(() => items.map(itemKey).join('\u0002'), [items]);
  const stableItems = useMemo(() => items.map((item) => ({ ...item })), [signature]);
  const [resolved, setResolved] = useState<{
    readonly theme: SymbolTheme;
    readonly signature: string;
    readonly tiles: ReadonlyMap<string, ThemeTile>;
  }>({ theme, signature, tiles: new Map() });

  useEffect(() => {
    if (theme === 'emoji' || stableItems.length === 0) {
      setResolved({ theme, signature, tiles: new Map() });
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, ThemeTile>();
      const groups = await Promise.all(
        chunk(stableItems, batchSize).map((group) => loadTiles(group, theme, singleSubject)),
      );
      groups.forEach((groupTiles) => {
        groupTiles.forEach((tile, key) => next.set(key, tile));
      });
      if (cancelled) return;
      // Keep the previous theme intact until every batch for this surface is
      // ready. This avoids a board changing one row at a time.
      setResolved({ theme, signature, tiles: new Map(next) });
    })();
    return () => {
      cancelled = true;
    };
  }, [batchSize, singleSubject, stableItems, theme]);

  if (resolved.theme === theme && resolved.signature === signature) return resolved.tiles;

  // The application-level theme preparation has already filled this memory
  // before it changes the displayed theme. Read it during render so every
  // surface flips in that same React commit rather than in later effects.
  const immediate = new Map<string, ThemeTile>();
  if (theme !== 'emoji') {
    stableItems.forEach((item) => {
      const tile = resolvedMemory.get(themedItemKey(theme, item, singleSubject));
      if (tile) immediate.set(itemKey(item), tile);
    });
  }
  return immediate;
}

export interface ThemePreparationGroup {
  readonly items: readonly ThemeIconRequestItem[];
  readonly batchSize?: number;
  readonly singleSubject?: boolean;
}

/**
 * Keep the currently displayed theme in place while the next theme is being
 * prepared across every board. Once all groups have restored or generated,
 * the entire application receives the new theme in the same render.
 */
export function usePreparedSymbolTheme(
  requestedTheme: SymbolTheme,
  groups: readonly ThemePreparationGroup[],
): SymbolTheme {
  const signature = groups.map((group) => [
    group.singleSubject === true ? 'single' : 'board',
    Math.max(1, Math.min(9, group.batchSize ?? 9)),
    group.items.map(itemKey).join('\u0002'),
  ].join('\u0003')).join('\u0004');
  const stableGroups = useMemo<readonly ThemePreparationGroup[]>(
    () => groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item })),
    })),
    [signature],
  );
  const [displayedTheme, setDisplayedTheme] = useState<SymbolTheme>('emoji');

  useEffect(() => {
    if (requestedTheme === 'emoji') {
      setDisplayedTheme('emoji');
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      await Promise.all(stableGroups.flatMap((group) => {
        const size = Math.max(1, Math.min(9, group.batchSize ?? 9));
        return chunk(group.items, size).map((items) =>
          loadTiles(items, requestedTheme, group.singleSubject === true),
        );
      }));
      if (!cancelled) setDisplayedTheme(requestedTheme);
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedTheme, stableGroups]);

  return displayedTheme;
}

export function themeTileFor(
  tiles: ReadonlyMap<string, ThemeTile>,
  item: ThemeIconRequestItem,
): ThemeTile | undefined {
  return tiles.get(itemKey(item));
}

/** Allows a fresh app session to be exercised without reloading the test VM. */
export function resetThemedSymbolMemoryForTests(): void {
  itemMemory.clear();
  resolvedMemory.clear();
  activeGenerations = 0;
  generationWaiters.splice(0);
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
