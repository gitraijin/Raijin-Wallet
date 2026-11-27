import Svg, { Circle, Path } from 'react-native-svg';

/** Line icons for the Fujin style (same look as in the Fujin app). */
const ICONS = {
  scan: (c: string) => (
    <>
      <Path d="M4 8.5 V4.5 H8.5 M15.5 4.5 H20 V8.5 M20 15.5 V19.5 H15.5 M8.5 19.5 H4 V15.5" stroke={c} />
      <Path d="M7.5 12 H16.5" stroke={c} />
    </>
  ),
  settings: (c: string) => (
    <>
      <Circle cx="12" cy="12" r="3" stroke={c} />
      <Path
        d="M12 3 V5.5 M12 18.5 V21 M3 12 H5.5 M18.5 12 H21 M5.6 5.6 L7.4 7.4 M16.6 16.6 L18.4 18.4 M5.6 18.4 L7.4 16.6 M16.6 7.4 L18.4 5.6"
        stroke={c}
      />
    </>
  ),
  eye: (c: string) => (
    <>
      <Path d="M2.5 12 C5 7.5 8.3 5.5 12 5.5 C15.7 5.5 19 7.5 21.5 12 C19 16.5 15.7 18.5 12 18.5 C8.3 18.5 5 16.5 2.5 12 Z" stroke={c} />
      <Circle cx="12" cy="12" r="3" stroke={c} />
    </>
  ),
  eyeOff: (c: string) => (
    <>
      <Path d="M2.5 12 C5 7.5 8.3 5.5 12 5.5 C15.7 5.5 19 7.5 21.5 12 C19 16.5 15.7 18.5 12 18.5 C8.3 18.5 5 16.5 2.5 12 Z" stroke={c} />
      <Path d="M4 20 L20 4" stroke={c} />
    </>
  ),
} as const;

export function StyleIcon({ name, color, size = 24 }: { name: keyof typeof ICONS; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name](color)}
    </Svg>
  );
}
