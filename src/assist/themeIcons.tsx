import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react';
import { actions, useStore } from '@/state/store';
import type { AppState, SymbolTheme } from '@/state/store';
import { normalizedChoice } from './choiceAvailability';
import { themeImageCacheScope } from './themeImageSharing';
import type { ThemeIconRequestItem, ThemeSprite } from './types';

export interface ThemeTile extends ThemeSprite {
  readonly index: number;
}

type ThemedKey = string;
type ThemePresentation = NonNullable<ThemeIconRequestItem['presentation']>;
type ThemeAudienceGender = AppState['settings']['voiceGender'];

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
const resolvedMemoryListeners = new Set<() => void>();
let resolvedMemoryRevision = 0;
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

function subscribeResolvedMemory(listener: () => void): () => void {
  resolvedMemoryListeners.add(listener);
  return () => resolvedMemoryListeners.delete(listener);
}

function resolvedMemorySnapshot(): number {
  return resolvedMemoryRevision;
}

function announceResolvedMemory(): void {
  resolvedMemoryRevision += 1;
  resolvedMemoryListeners.forEach((listener) => listener());
}

function publishResolvedTiles(tiles: ReadonlyMap<ThemedKey, ThemeTile>): void {
  let changed = false;
  tiles.forEach((tile, key) => {
    if (resolvedMemory.get(key) === tile) return;
    resolvedMemory.set(key, tile);
    changed = true;
  });
  if (changed) announceResolvedMemory();
}

function itemKey(item: ThemeIconRequestItem): string {
  // The word's meaning owns the picture. A changing health/fallback emoji must
  // not disconnect the button from artwork already made for the same label.
  return `${item.presentation ?? 'subject'}\u0000${normalizedChoice(item.text)}`;
}

function themedItemKey(
  theme: Exclude<SymbolTheme, 'emoji'>,
  item: ThemeIconRequestItem,
  singleSubject: boolean,
  audienceGender: ThemeAudienceGender,
): ThemedKey {
  // A button's meaning, rather than its fallback emoji or punctuation, owns
  // the picture. This is the same identity used by the signed-in R2 library.
  const presentation = item.presentation ?? 'subject';
  const audience = presentation === 'subject' || audienceGender === 'neutral'
    ? ''
    : `\u0000audience:${audienceGender}`;
  return `${theme}\u0000${singleSubject ? 'single' : 'board'}\u0000${presentation}\u0000${normalizedChoice(item.text)}${audience}`;
}

function itemPresentation(items: readonly ThemeIconRequestItem[]): ThemePresentation {
  return items[0]?.presentation ?? 'subject';
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
  audienceGender: ThemeAudienceGender,
): Promise<GenerationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/assist/theme-icons', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'image/png' },
        credentials: 'same-origin',
        body: JSON.stringify({
          theme,
          items,
          singleSubject,
          presentation: itemPresentation(items),
          audienceGender,
        }),
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
  audienceGender: ThemeAudienceGender,
): Promise<readonly SavedGroup[]> {
  try {
    const response = await fetch('/api/assist/theme-icons', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        theme,
        items,
        singleSubject,
        presentation: itemPresentation(items),
        audienceGender,
        lookupOnly: true,
      }),
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
  presentation: ThemePresentation,
  audienceGender: ThemeAudienceGender,
): Promise<SpritePayload | null> {
  try {
    const params = new URLSearchParams({
      theme,
      text,
      singleSubject: String(singleSubject),
      presentation,
      audienceGender,
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
  audienceGender: ThemeAudienceGender,
): Promise<ReadonlyMap<ThemedKey, ThemeTile>> {
  const result = new Map<ThemedKey, ThemeTile>();
  let missing = [...items];

  // A competing browser may be creating one of these choices. Recheck the
  // shared library after its short lease response instead of submitting a
  // second image request. Eight passes cover the normal generation window.
  for (let pass = 0; pass < 8 && missing.length > 0; pass += 1) {
    const groups = await lookupSavedGroups(missing, theme, singleSubject, audienceGender);

    // One saved sheet may contain several requested buttons. Fetch that sheet
    // once, then reconnect every matching button to its original cell.
    await Promise.all(groups.map(async (group) => {
      const payload = await requestSavedSprite(
        theme,
        group.probeText,
        singleSubject,
        itemPresentation(items),
        audienceGender,
      );
      if (!payload) return;
      const sprite = spriteFromBlob(payload.blob, group.columns, group.rows);
      if (!sprite) return;
      group.tiles.forEach(({ requestIndex, index }) => {
        const item = missing[requestIndex];
        if (!item || !Number.isInteger(index) || index < 0) return;
        result.set(themedItemKey(theme, item, singleSubject, audienceGender), { ...sprite, index });
      });
      publishResolvedTiles(result);
    }));

    missing = items.filter((item) => !result.has(themedItemKey(theme, item, singleSubject, audienceGender)));
    if (missing.length === 0) break;

    // Never place a private choice beside a shared one in the same downloaded
    // sprite sheet. The server independently enforces this boundary.
    const partitions = [
      missing.filter((item) => themeImageCacheScope(item.text) === 'shared'),
      missing.filter((item) => themeImageCacheScope(item.text) === 'private'),
    ].filter((partition) => partition.length > 0);

    let refreshDelay = 0;
    const generatedPartitions = await Promise.all(partitions.map(async (partition) => {
      const taskId = actions.beginAssistTask('themes', pictureTaskLabel(partition));
      const generated = await withGenerationSlot(
        () => requestGeneratedSprite(partition, theme, singleSubject, audienceGender),
      );
      return { generated, partition, taskId };
    }));

    generatedPartitions.forEach(({ generated, partition, taskId }) => {
      if (generated.kind === 'refresh') {
        refreshDelay = Math.max(refreshDelay, generated.retryAfterMs);
        actions.finishAssistTask('themes', 'idle', 0, taskId);
        return;
      }
      if (generated.kind !== 'image') {
        actions.finishAssistTask('themes', 'unavailable', 0, taskId);
        return;
      }
      const sprite = spriteFromBlob(
        generated.payload.blob,
        generated.payload.columns,
        generated.payload.rows,
      );
      if (!sprite) {
        actions.finishAssistTask('themes', 'unavailable', 0, taskId);
        return;
      }
      const published = new Map<ThemedKey, ThemeTile>();
      partition.forEach((item, index) => {
        const key = themedItemKey(theme, item, singleSubject, audienceGender);
        const tile = { ...sprite, index };
        result.set(key, tile);
        published.set(key, tile);
      });
      // Publish the artwork before marking its task complete. Every mounted
      // surface can now paint it in the same update that removes "Active".
      publishResolvedTiles(published);
      actions.finishAssistTask('themes', 'ready', partition.length, taskId);
    });

    missing = items.filter((item) => !result.has(themedItemKey(theme, item, singleSubject, audienceGender)));
    if (missing.length === 0 || refreshDelay === 0) break;
    await new Promise((resolve) => setTimeout(resolve, refreshDelay));
  }
  return result;
}

async function loadTiles(
  items: readonly ThemeIconRequestItem[],
  theme: Exclude<SymbolTheme, 'emoji'>,
  singleSubject: boolean,
  audienceGender: ThemeAudienceGender,
): Promise<ReadonlyMap<string, ThemeTile>> {
  const uniqueMissing = new Map<ThemedKey, ThemeIconRequestItem>();
  items.forEach((item) => {
    const key = themedItemKey(theme, item, singleSubject, audienceGender);
    if (!itemMemory.has(key)) uniqueMissing.set(key, item);
  });

  if (uniqueMissing.size > 0) {
    const missing = [...uniqueMissing.values()];
    // Register the shared promise immediately so overlapping prewarm and
    // visible-board hooks join the same restore/generation work.
    const groupPromise = loadMissingTiles(missing, theme, singleSubject, audienceGender);
    missing.forEach((item) => {
      const key = themedItemKey(theme, item, singleSubject, audienceGender);
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
      tile: await itemMemory.get(themedItemKey(theme, item, singleSubject, audienceGender)),
    })),
  );
  const result = new Map<string, ThemeTile>();
  const published = new Map<ThemedKey, ThemeTile>();
  resolved.forEach(({ item, tile }) => {
    if (tile) {
      const memoryKey = themedItemKey(theme, item, singleSubject, audienceGender);
      published.set(memoryKey, tile);
      result.set(itemKey(item), tile);
    }
  });
  publishResolvedTiles(published);
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

/** Restore batches in parallel and publish each one as soon as it is ready. */
export function useThemedSymbols(
  items: readonly ThemeIconRequestItem[],
  theme: SymbolTheme,
  options: { batchSize?: number; singleSubject?: boolean } = {},
): ReadonlyMap<string, ThemeTile> {
  const audienceGender = useStore((state) => state.settings.voiceGender);
  useSyncExternalStore(
    subscribeResolvedMemory,
    resolvedMemorySnapshot,
    resolvedMemorySnapshot,
  );
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
    const next = new Map<string, ThemeTile>();

    // Apply the selected theme immediately. Any pictures already restored in
    // this session appear in the first render; missing pictures keep their
    // emoji fallback and fill in independently as their batch finishes.
    stableItems.forEach((item) => {
      const tile = resolvedMemory.get(themedItemKey(theme, item, singleSubject, audienceGender));
      if (tile) next.set(itemKey(item), tile);
    });
    setResolved({ theme, signature, tiles: new Map(next) });

    chunk(stableItems, batchSize).forEach((group) => {
      void loadTiles(group, theme, singleSubject, audienceGender).then((groupTiles) => {
        if (cancelled) return;
        groupTiles.forEach((tile, key) => next.set(key, tile));
        setResolved({ theme, signature, tiles: new Map(next) });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [audienceGender, batchSize, singleSubject, stableItems, theme]);

  // The application-level preparation and visible surfaces share one memory.
  // Merge it during every render so a completed image appears everywhere in
  // the same React commit, even when another hook performed the generation.
  const immediate = resolved.theme === theme && resolved.signature === signature
    ? new Map(resolved.tiles)
    : new Map<string, ThemeTile>();
  if (theme !== 'emoji') {
    stableItems.forEach((item) => {
      const tile = resolvedMemory.get(themedItemKey(theme, item, singleSubject, audienceGender));
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
 * Apply the selected theme immediately and prewarm every board in parallel.
 * Missing pictures use their emoji fallback until their own batch is ready.
 */
export function usePreparedSymbolTheme(
  requestedTheme: SymbolTheme,
  groups: readonly ThemePreparationGroup[],
): SymbolTheme {
  const audienceGender = useStore((state) => state.settings.voiceGender);
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
  useEffect(() => {
    if (requestedTheme === 'emoji') return undefined;
    stableGroups.forEach((group) => {
      const size = Math.max(1, Math.min(9, group.batchSize ?? 9));
      chunk(group.items, size).forEach((items) => {
        void loadTiles(items, requestedTheme, group.singleSubject === true, audienceGender);
      });
    });
    return undefined;
  }, [audienceGender, requestedTheme, stableGroups]);

  return requestedTheme;
}

export interface ThemePreviewPreload {
  readonly theme: Exclude<SymbolTheme, 'emoji'>;
  readonly item: ThemeIconRequestItem;
}

/** Warm every style preview before Settings opens without mounting hidden UI. */
export function usePreloadedThemePreviews(
  previews: readonly ThemePreviewPreload[],
  enabled: boolean,
): void {
  const signature = previews
    .map(({ theme, item }) => `${theme}\u0000${itemKey(item)}`)
    .join('\u0002');
  const stablePreviews = useMemo(
    () => previews.map(({ theme, item }) => ({ theme, item: { ...item } })),
    [signature],
  );
  useEffect(() => {
    if (!enabled) return undefined;
    stablePreviews.forEach(({ theme, item }) => {
      void loadTiles([item], theme, true, 'neutral');
    });
    return undefined;
  }, [enabled, stablePreviews]);
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
  announceResolvedMemory();
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
