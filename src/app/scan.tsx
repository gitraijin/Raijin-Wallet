import { useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NfcReader } from '@/components/NfcReader';
import { QrCamera } from '@/components/QrCamera';
import { Button, ErrorText, Header, Mono, Screen } from '@/components/ui';
import { deliverScan } from '@/lib/scan-result';
import { routeForScan } from '@/lib/scan-route';
import { useHaptics } from '@/motion';
import { useT } from '@/preferences/PreferencesContext';
import { makeStyles, space, useTheme } from '@/theme';

/**
 * QR scanner (phone camera, desktop webcam) and NFC reader (Android, iOS).
 * Recognizes invoices, addresses, LNURL (incl. Bolt Cards), Lightning
 * addresses, Cashu tokens, connection strings and node URIs and opens the
 * matching screen.
 */
export default function Scan() {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useT();
  const haptic = useHaptics();
  const [permission, requestPermission] = useCameraPermissions();
  const [unknown, setUnknown] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const handled = useRef(false);
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const returning = mode === 'return';

  // Leaving without a result (back button) releases a waiting field.
  useEffect(() => () => void (returning && !handled.current && deliverScan(null)), [returning]);

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    if (returning) {
      handled.current = true;
      haptic('success');
      deliverScan(data.trim());
      router.back();
      return;
    }
    const target = routeForScan(data);
    if (!target) {
      setUnknown(data);
      return;
    }
    handled.current = true;
    haptic('success');
    router.replace(target);
  };

  // An NFC tag goes the same way as a QR code; the first usable record wins.
  const onNfc = (texts: string[]): boolean => {
    if (handled.current) return true;
    if (returning) {
      if (!texts[0]) return false;
      onScanned({ data: texts[0] });
      return true;
    }
    const usable = texts.find((text) => routeForScan(text));
    if (!usable) {
      setUnknown(texts[0] ?? t('nfc.empty'));
      return false;
    }
    onScanned({ data: usable });
    return true;
  };
  const nfc = <NfcReader onTag={onNfc} />;

  if (!permission) return <Screen><Header title={t('scan.title')} />{nfc}</Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Header title={t('scan.title')} />
        <Mono style={styles.hint}>{t('scan.permission')}</Mono>
        {permission.canAskAgain ? (
          <Button label={t('scan.allow')} onPress={requestPermission} />
        ) : (
          <ErrorText>{t('scan.denied')}</ErrorText>
        )}
        {nfc}
        {unknown ? <ErrorText>{t('scan.unknown', { value: unknown.slice(0, 60) })}</ErrorText> : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={t('scan.title')} />
      <View style={styles.frame}>
        <QrCamera torch={torch} onScanned={onScanned} />
        {/* Terminal-style viewfinder corners */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <View key={corner} style={[styles.corner, styles[corner], { borderColor: colors.primary }]} />
        ))}
      </View>
      <Mono style={styles.hint}>{t('scan.hint')}</Mono>
      {nfc}
      {unknown ? <ErrorText>{t('scan.unknown', { value: unknown.slice(0, 60) })}</ErrorText> : null}
      <Button label={torch ? t('scan.torchOff') : t('scan.torchOn')} variant="ghost" onPress={() => setTorch(!torch)} />
    </Screen>
  );
}

const CORNER = 28;

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    frame: { aspectRatio: 1, width: '100%', overflow: 'hidden', backgroundColor: '#000' },
    hint: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
    corner: { position: 'absolute', width: CORNER, height: CORNER },
    tl: { top: space.md, left: space.md, borderTopWidth: 3, borderLeftWidth: 3 },
    tr: { top: space.md, right: space.md, borderTopWidth: 3, borderRightWidth: 3 },
    bl: { bottom: space.md, left: space.md, borderBottomWidth: 3, borderLeftWidth: 3 },
    br: { bottom: space.md, right: space.md, borderBottomWidth: 3, borderRightWidth: 3 },
  }),
);
