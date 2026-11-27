/**
 * Geometry of the Raijin mark (horned oni head, lightning-bolt face) in a
 * 100x100 box. Shared by the in-app logo (BrandMark.tsx) and the Android
 * widget; the icon generator (scripts/generate-icons.py) and the website use
 * the same paths.
 */
export const MARK_HORNS = [
  'M25 46 C17 38 14 26 19 12 C22 22 30 30 40 38 Z',
  'M75 46 C83 38 86 26 81 12 C78 22 70 30 60 38 Z',
];

/** Head with eyes and bolt as holes (even-odd), so the background shows through. */
export const MARK_FACE = [
  'M24 44 C20 54 21 68 27 78 C33 88 42 93 50 93 C58 93 67 88 73 78 C79 68 80 54 76 44 C70 36 30 36 24 44 Z',
  'M31 58 L45 62 L43.5 66.5 L32.5 63 Z',
  'M69 58 L55 62 L56.5 66.5 L67.5 63 Z',
  'M53.5 46 L45.5 66 L50.5 66 L46.5 87 L57 60 L52 60 L57 46 Z',
].join(' ');

/** The mark as a standalone SVG document, e.g. for the home-screen widget. */
export function markSvg(color: string): string {
  const horns = MARK_HORNS.map((d) => `<path d="${d}" fill="${color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${horns}<path d="${MARK_FACE}" fill="${color}" fill-rule="evenodd"/></svg>`;
}
