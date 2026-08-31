export type ThemeAudienceGender = 'male' | 'female' | 'neutral';

/** Keep character-free Hello Kitty controls aligned with the selected audience. */
export function helloKittyControlDirection(audience: ThemeAudienceGender): string {
  if (audience === 'male') {
    return 'Style the functional icon itself with rounded white kawaii surfaces, blue, teal, red, and gold accents, and subtle cap-panel, hoodie-seam, or sneaker-stripe details integrated into its existing shape. Do not use bows, ribbons, dresses, pink feminine accents, or the standard girl character design. Do not add a kitten, person, clothing item, or separate object.';
  }
  if (audience === 'female') {
    return 'Style the functional icon itself with rounded white kawaii surfaces, balanced pink, red, lilac, and soft blue accents, and one small bow detail integrated into its existing shape. Do not add a kitten, person, clothing item, or separate object.';
  }
  return 'Style the functional icon itself with rounded white kawaii surfaces and balanced blue, red, lilac, teal, and gold accents. Use simple cat-ear corner or stitched-toy details without bows, ribbons, clothing, characters, or separate objects.';
}

/** Keep character-free Hello Kitty backgrounds aligned with the selected audience. */
export function helloKittyWallpaperDirection(audience: ThemeAudienceGender): string {
  if (audience === 'male') {
    return 'Use an abstract kawaii atmosphere made only from deep and cobalt blue, teal, white, restrained red, and warm gold colour fields, rounded gradients, tiny light speckles, and plush-looking texture. The overall colour balance must feel boyish and confident, matching the cap, hoodie, and sneaker styling used elsewhere. Do not use a pink wash, bows, ribbons, feminine motifs, characters, mascots, clothing, or objects.';
  }
  if (audience === 'female') {
    return 'Use an abstract kawaii atmosphere made only from balanced pink, red, lilac, soft blue, and white colour fields, rounded gradients, tiny light speckles, and plush-looking texture. Keep the result polished and feminine without depicting characters, mascots, bows, clothing, or objects.';
  }
  return 'Use an abstract kawaii atmosphere made only from balanced blue, teal, lilac, restrained red, gold, and white colour fields, rounded gradients, tiny light speckles, and plush-looking texture. Do not let pink dominate, and do not depict bows, ribbons, gender-coded motifs, characters, mascots, clothing, or objects.';
}
