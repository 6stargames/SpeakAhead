import { describe, expect, it } from 'vitest';
import { helloKittyControlDirection } from '@/assist/themeGenderDirections';

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
