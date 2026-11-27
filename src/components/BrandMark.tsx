import Svg, { Path } from 'react-native-svg';

import { brand } from '@/theme';

import { MARK_FACE, MARK_HORNS } from './brand-mark-paths';

/**
 * The Raijin mark: a horned oni head with a lightning-bolt face, in Bitcoin
 * orange. Geometry in brand-mark-paths.ts, shared with the widget and icons.
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Raijin Wallet logo">
      {MARK_HORNS.map((d) => (
        <Path key={d} d={d} fill={brand.mark} />
      ))}
      <Path d={MARK_FACE} fill={brand.mark} fillRule="evenodd" />
    </Svg>
  );
}
