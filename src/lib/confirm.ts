import { Alert, Platform } from 'react-native';

/**
 * Yes/no question that works everywhere: native Alert on Android/iOS, the
 * browser confirm dialog on web/desktop (Alert has no buttons there).
 */
export function confirmAction(
  title: string,
  message: string | undefined,
  confirmLabel: string,
  cancelLabel: string,
  destructive = true,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(Boolean(globalThis.confirm?.(message ? `${title}\n\n${message}` : title)));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
