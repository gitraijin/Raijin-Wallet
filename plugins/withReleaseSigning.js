// Signs release builds with the Raijin release key instead of the template's
// debug key. The key and its passwords never live in the repository; Gradle
// reads them from ~/.gradle/gradle.properties on the build machine:
//
//   RAIJIN_RELEASE_STORE_FILE=/path/to/raijin-release.p12
//   RAIJIN_RELEASE_STORE_PASSWORD=...
//   RAIJIN_RELEASE_KEY_ALIAS=raijin
//   RAIJIN_RELEASE_KEY_PASSWORD=...
//
// Without them a release build falls back to the debug key and says so loudly;
// such an APK must never be published (users could not update it later).
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
        release {
            if (project.hasProperty('RAIJIN_RELEASE_STORE_FILE')) {
                storeFile file(RAIJIN_RELEASE_STORE_FILE)
                storePassword RAIJIN_RELEASE_STORE_PASSWORD
                keyAlias RAIJIN_RELEASE_KEY_ALIAS
                keyPassword RAIJIN_RELEASE_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('RAIJIN_RELEASE_STORE_FILE')) return cfg;

    // 1. A release signing config next to the template's debug one.
    gradle = gradle.replace(/(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/, `$1${SIGNING}`);

    // 2. The release build type uses it when the key is configured.
    gradle = gradle.replace(
      /(release\s*\{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/,
      `$1if (project.hasProperty('RAIJIN_RELEASE_STORE_FILE')) {
                signingConfig signingConfigs.release
            } else {
                logger.warn('\\n*** Raijin: no release key configured, signing with the DEBUG key. Do not publish this APK. ***\\n')
                signingConfig signingConfigs.debug
            }`,
    );
    if (!gradle.includes('signingConfigs.release')) {
      throw new Error('withReleaseSigning: build.gradle layout changed, signing config not applied');
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
