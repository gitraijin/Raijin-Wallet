# Building

## Checks before every build

```bash
npm ci
npx tsc --noEmit
npx expo lint
```

## Android release APK

```bash
# android/ is generated and git-ignored
npx expo prebuild --platform android --clean
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → app/build/outputs/apk/release/app-release.apk
```

Always pass `-PreactNativeArchitectures=arm64-v8a`. Without it the APK carries every ABI (including `libtor.so` for each) and grows to about three times the size.

### Release signing

`plugins/withReleaseSigning.js` signs release builds with the Raijin release key. The key is **not** in the repository; Gradle reads it from `~/.gradle/gradle.properties` on the build machine:

```properties
RAIJIN_RELEASE_STORE_FILE=/path/to/raijin-release.p12
RAIJIN_RELEASE_STORE_PASSWORD=...
RAIJIN_RELEASE_KEY_ALIAS=raijin
RAIJIN_RELEASE_KEY_PASSWORD=...
```

Without these entries the build falls back to the debug key and warns. Such an APK must never be published: installs could not be updated by official releases.

Official APKs carry this certificate (SHA-256):

```text
AF:AC:41:1E:EC:61:3B:98:99:B0:C7:1A:65:D3:86:02:5E:68:6B:82:E3:61:14:57:88:9B:9B:41:F7:C8:6C:0A
```

Check an APK with `apksigner verify --print-certs raijin-wallet.apk`.

## Desktop (Windows, macOS, Linux)

```bash
npm run desktop:web                     # export the web app (after every app change)
cd desktop && npm ci
node scripts/fetch-tor.mjs              # bundled Tor for the current platform
npx electron .                          # run
npx electron-builder --publish never    # packages → dist/desktop/
```

| System | Packages |
|---|---|
| Windows | NSIS installer, portable `.exe` (unsigned: SmartScreen asks once) |
| macOS | `.dmg` and `.zip` for arm64 and x64, ad-hoc signed (first start: right-click → Open) |
| Linux | `.AppImage`, `.deb`, `.tar.gz` |

macOS packages can only be built on a Mac. The workflow `.github/workflows/desktop.yml` builds all three systems; it runs on demand and on `v*` tags.

## Verifying downloads

Every release on [raijinhub.com/download](https://raijinhub.com/download/) ships a `SHA256SUMS` file signed with the RaijinHub release PGP key (fingerprint `774A 9E07 9165 2C79 EB27 EC20 CF80 DE65 3E9A 3C20`):

```bash
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
```

## Zapstore

`zapstore.yaml` describes the [Zapstore](https://zapstore.dev) listing. A release is published with `zsp publish` after the signed arm64 APK is copied to `dist/zapstore/raijin-wallet.apk`.
