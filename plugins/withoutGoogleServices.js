// Keeps Google Play services and Google ML Kit out of the Android build.
// QR codes use modules/raijin-scan (CameraX + ZXing) instead. expo-camera's
// QR scanner is turned off with its own plugin option (barcodeScannerEnabled:
// false); this plugin also turns off its document scanner, which has no option
// of its own, and drops the ML Kit download hint expo-camera's manifest carries.
// Both switches only work because package.json builds expo-camera from source
// (expo.autolinking.android.buildFromSource); the prebuilt package ignores them.
const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');

const PROPS = { 'expo.camera.document-scanner-enabled': 'false' };
const REMOVE_META = ['com.google.mlkit.vision.DEPENDENCIES'];

function withProps(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      cfg.modResults = cfg.modResults.filter((item) => !(item.type === 'property' && item.key === key));
      cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
}

function withoutMeta(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app['meta-data'] = (app['meta-data'] ?? []).filter((m) => !REMOVE_META.includes(m.$['android:name']));
    for (const name of REMOVE_META) app['meta-data'].push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    return cfg;
  });
}

module.exports = function withoutGoogleServices(config) {
  return withoutMeta(withProps(config));
};
