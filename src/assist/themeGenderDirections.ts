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
