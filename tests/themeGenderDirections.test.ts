import { describe, expect, it } from 'vitest';
import {
  helloKittyControlDirection,
  helloKittyWallpaperDirection,
} from '@/assist/themeGenderDirections';

describe('Hello Kitty functional icon gender direction', () => {
  it('keeps male controls aligned with the cap-and-hoodie character treatment', () => {
    const direction = helloKittyControlDirection('male');

    expect(direction).toContain('cap-panel');
    expect(direction).toContain('hoodie-seam');
    expect(direction).toContain('Do not use bows');
  });

  it('reserves bow details for the female control treatment', () => {
    expect(helloKittyControlDirection('female')).toContain('one small bow detail');
    expect(helloKittyControlDirection('neutral')).toContain('without bows');
  });
});

describe('Hello Kitty ambient background gender direction', () => {
  it('uses the boy-character palette for male ambient backgrounds', () => {
    const direction = helloKittyWallpaperDirection('male');

    expect(direction).toContain('cobalt blue');
    expect(direction).toContain('teal');
    expect(direction).toContain('Do not use a pink wash');
    expect(direction).toContain('Do not use a pink wash, bows, ribbons');
  });

  it('keeps female and neutral ambient palettes distinct', () => {
    expect(helloKittyWallpaperDirection('female')).toContain('pink, red, lilac');
    expect(helloKittyWallpaperDirection('neutral')).toContain('Do not let pink dominate');
  });
});
