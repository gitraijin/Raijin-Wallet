# Development

Expo ships breaking changes with every SDK. Check the current Expo documentation before touching Expo or React Native APIs (see `AGENTS.md`).

## Translations (`src/i18n/`)

- `en.ts` is the source (`as const`) and defines the `TKey` type.
- Every other language is a `Record<TKey, string>`, so missing or extra keys are type errors.
- Placeholders: `{name}`, filled by `t('key', { name: 'x' })`.
- Dynamic keys (`` t(`state.${channel.state}` as TKey) ``) need a cast.
- Two UI styles: the terminal style uses lower-case hints with a leading `> `; the Fujin style turns them into plain sentences (`plainText()` in `index.ts`, German overrides in `de-plain.ts`).

## UI building blocks (`src/components/ui.tsx`)

`Screen`, `Header`, `Panel`, `InfoRow`, `Button` (`primary`, `secondary`, `ghost`, `danger`), `Input`, `Segmented`, `Chips`, plus domain parts such as `FeePicker`, `ChannelCard`, `PaymentRow`, `QrBlock` and `PinPad`.

Styles always go through `makeStyles((colors) => StyleSheet.create({...}))` so every theme and both UI styles work. No hard-coded colors.

## Patterns

- Two-phase payments: prepare (`SendQuote`) → summary → `confirm()` → result.
- Optional backend capabilities: `backend.channels ? … : null` instead of checking the backend type.
- Async effects carry a `cancelled` flag; no `setState` directly in an effect body (derive values instead).
- Network only through `src/lightning/http.ts`, otherwise Tor does not apply.

## Testing pure logic

Parsers and encoders without React or native dependencies run directly in Node 24 with type stripping:

```bash
node --experimental-strip-types --no-warnings test.ts
```

Copy the module into a temporary folder, stub what cannot run in Node (Expo, native modules) and import it from a small test script.

## Commits

- English commit messages, one commit per finished step.
- Typecheck and lint before committing.
- `android/`, `ios/`, `dist/` and native build folders are git-ignored.
