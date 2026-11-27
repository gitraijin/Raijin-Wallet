import '@/lib/polyfills';
import '@/net/install-websocket';
// Defines the background payment check at module scope (headless start).
import '@/notify/background';

import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  useFonts,
} from '@expo-google-fonts/jetbrains-mono';
// Manrope for the optional Fujin style (Settings → theme → style).
import { Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useSyncExternalStore } from 'react';

import { CashuProvider } from '@/cashu/CashuContext';
import { LinkBridge } from '@/components/LinkBridge';
import { LockOverlay } from '@/components/LockOverlay';
import { getStorageEpoch, subscribeStorageEpoch } from '@/lib/storage-namespace';
import { useMotion } from '@/motion';
import { PaymentToast } from '@/motion/PaymentToast';
import { NotificationBridge } from '@/notify/NotificationBridge';
import { WidgetBridge } from '@/widget/WidgetBridge';
import { PrivacyGuard } from '@/security/PrivacyGuard';
import { Scanlines } from '@/motion/Scanlines';
import { PreferencesProvider, usePreferences } from '@/preferences/PreferencesContext';
import { PriceProvider } from '@/preferences/PriceContext';
import { SecurityProvider, useSecurity } from '@/security/SecurityContext';
import { ThemeProvider, useTheme } from '@/theme';
import { WalletProvider } from '@/wallet/WalletContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <SecurityProvider>
          <App />
        </SecurityProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}

function App() {
  const { colors, dark, loaded: themeLoaded } = useTheme();
  const { loaded: securityLoaded, decoy } = useSecurity();
  const { loaded: prefsLoaded } = usePreferences();
  const motion = useMotion();
  const storageEpoch = useSyncExternalStore(subscribeStorageEpoch, getStorageEpoch, getStorageEpoch);
  const [fontsLoaded, fontError] = useFonts({
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  // Wait for security so the lock overlay is up before any wallet content renders.
  const ready = (fontsLoaded || fontError !== null) && themeLoaded && securityLoaded && prefsLoaded;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    // Keyed on the duress mode: switching remounts wallet and Cashu state.
    <WalletProvider key={`${decoy ? 'decoy' : 'real'}-${storageEpoch}`}>
      <PriceProvider>
        <CashuProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: motion ? 'slide_from_right' : 'none',
          }}
        />
        <NotificationBridge />
        <LinkBridge />
        <WidgetBridge />
        <PrivacyGuard />
        <PaymentToast />
        <Scanlines />
        <LockOverlay />
        </CashuProvider>
      </PriceProvider>
    </WalletProvider>
  );
}
