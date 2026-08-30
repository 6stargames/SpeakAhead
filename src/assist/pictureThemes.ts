export const PICTURE_THEME_IDS = [
  'ghibli',
  'baby-shark',
  'hello-kitty',
  'claymation',
  'pixel-art',
  'halo-3',
  'stained-glass',
  'pop-art',
  'cubism',
  'ukiyo-e',
  'papercraft',
  'neon-cyberpunk',
  'felted-wool',
  'mid-century',
] as const;

export type PictureTheme = typeof PICTURE_THEME_IDS[number];
export type SymbolTheme = 'emoji' | PictureTheme;

export interface PictureThemeOption {
  readonly label: string;
  readonly value: SymbolTheme;
}

export const PRIMARY_PICTURE_THEMES: readonly PictureThemeOption[] = [
  { label: 'Emoji', value: 'emoji' },
  { label: 'Ghibli Style', value: 'ghibli' },
  { label: 'Baby Shark', value: 'baby-shark' },
  { label: 'Hello Kitty', value: 'hello-kitty' },
];

export const MORE_PICTURE_THEMES: readonly PictureThemeOption[] = [
  { label: 'Claymation', value: 'claymation' },
  { label: 'Pixel Art', value: 'pixel-art' },
  { label: 'HALO 3', value: 'halo-3' },
  { label: 'Stained Glass', value: 'stained-glass' },
  { label: 'Pop Art', value: 'pop-art' },
  { label: 'Cubism', value: 'cubism' },
  { label: 'Ukiyo-e', value: 'ukiyo-e' },
  { label: 'Papercraft', value: 'papercraft' },
  { label: 'Neon Cyberpunk', value: 'neon-cyberpunk' },
  { label: 'Felted Wool', value: 'felted-wool' },
  { label: 'Mid-Century', value: 'mid-century' },
];

export const ALL_PICTURE_THEMES: readonly PictureThemeOption[] = [
  ...PRIMARY_PICTURE_THEMES,
  ...MORE_PICTURE_THEMES,
];

export function isPictureTheme(value: unknown): value is PictureTheme {
  return typeof value === 'string' && (PICTURE_THEME_IDS as readonly string[]).includes(value);
}

/** Keep existing devices on their closest replacement after Anime is retired. */
export function normaliseSymbolTheme(value: unknown): SymbolTheme | null {
  if (value === 'emoji') return 'emoji';
  if (value === 'anime') return 'ghibli';
  if (value === 'halo-hud') return 'halo-3';
  return isPictureTheme(value) ? value : null;
}
