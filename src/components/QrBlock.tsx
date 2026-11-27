import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Mono } from '@/components/ui';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space } from '@/theme';

// Fixed, theme-independent colors: scanners need dark modules on a light background.
const QR_DARK = '#07080B';
const QR_LIGHT = '#FFFFFF';

/**
 * QR code plus the raw string and a copy button.
 *
 * The QR uses dark modules on a light background: inverted codes look more
 * "cyberpunk" but many wallet scanners fail to read them.
 */
export function QrBlock({ value, uri }: { value: string; uri?: string }) {
  const styles = useStyles();
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.qr}>
        <QRCode
          value={uri ?? value}
          size={240}
          color={QR_DARK}
          backgroundColor={QR_LIGHT}
          quietZone={12}
        />
      </View>
      <Mono style={styles.raw} selectable>
        {value}
      </Mono>
      <Button label={copied ? t('common.copied') : t('common.copy')} variant="ghost" onPress={copy} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: space.md },
    qr: {
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: colors.accent,
      padding: 4,
    },
    raw: { fontSize: 11, color: colors.textDim, lineHeight: 16 },
  }),
);
