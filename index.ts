/**
 * App entry. On Android the home-screen widget's task handler must be
 * registered before Expo Router starts (it also runs headless, without UI).
 */
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widget/task-handler');
  /* eslint-enable @typescript-eslint/no-require-imports */
  registerWidgetTaskHandler(widgetTaskHandler);
}

import 'expo-router/entry';
