import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';

import { markSvg } from '@/components/brand-mark-paths';

import { type BitcoinUnit, formatBitcoin, formatTimestamp, unitLabel } from '@/lib/format';
import { brand, type ThemeColors } from '@/theme';

import type { WidgetData } from './data';

type Hex = `#${string}`;
/** The mark is always orange, like the app icon. */
const MARK_SVG = markSvg(brand.mark);
const hex = (value: string) => value as Hex;

/**
 * Home-screen widget: Raijin mark + RAIJIN, node name, balance, lightning/on-chain
 * split and last update. Tapping opens the app.
 */
export function BalanceWidget({
  data,
  colors,
  hidden,
  unit,
}: {
  data: WidgetData | null;
  colors: ThemeColors;
  hidden: boolean;
  unit: BitcoinUnit;
}) {
  const amount = (sats: string | null) =>
    sats === null ? '—' : hidden ? '••••••' : formatBitcoin(BigInt(sats), unit);

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: hex(colors.bg),
        borderColor: hex(colors.borderStrong),
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <SvgWidget svg={MARK_SVG} style={{ width: 16, height: 16, marginRight: 4 }} />
          <TextWidget
            text="RAIJIN"
            style={{ fontSize: 12, fontFamily: 'JetBrainsMono_700Bold', color: hex(colors.primary), letterSpacing: 0.15 }}
          />
        </FlexWidget>
        <TextWidget
          text={data?.nodeName ?? ''}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', color: hex(colors.textDim) }}
        />
      </FlexWidget>

      {data ? (
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget
            text={`${amount(data.balanceSats)} ${unitLabel(unit)}`}
            maxLines={1}
            style={{ fontSize: 26, fontFamily: 'JetBrainsMono_700Bold', color: hex(colors.primary) }}
          />
          {data.lightningSats !== null ? (
            <TextWidget
              text={`ϟ ${amount(data.lightningSats)}   ₿ ${amount(data.onchainSats)}`}
              maxLines={1}
              style={{ fontSize: 11, fontFamily: 'JetBrainsMono_400Regular', color: hex(colors.textDim) }}
            />
          ) : null}
        </FlexWidget>
      ) : (
        <TextWidget
          text="> open raijin to connect"
          style={{ fontSize: 12, fontFamily: 'JetBrainsMono_400Regular', color: hex(colors.textDim) }}
        />
      )}

      <TextWidget
        text={data ? `synced ${formatTimestamp(Math.floor(data.updatedAt / 1000))}` : ''}
        style={{ fontSize: 10, fontFamily: 'JetBrainsMono_400Regular', color: hex(colors.textFaint) }}
      />
    </FlexWidget>
  );
}
