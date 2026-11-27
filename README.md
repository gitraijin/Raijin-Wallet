# Raijin Wallet ⚡

**Raijin Wallet** is an open-source Lightning node wallet, in the spirit of [Zeus](https://zeusln.com/).

> Named after Raijin, the Japanese god of thunder and lightning.

> ⚠️ **Status: beta.** Start with small amounts.

Download: [raijinhub.com/download](https://raijinhub.com/download/) (Android, Windows, macOS, Linux, with PGP-signed checksums) or [Zapstore](https://zapstore.dev). There is no iPhone/iPad version.

## Features

- Multiple nodes / wallets, switchable at any time:
  - `lndconnect://host:port?cert=...&macaroon=...`: LND via REST. Self-signed certificates work when the string carries the `cert`; `.onion` hosts connect over Tor.
  - `nostr+walletconnect://...`: Nostr Wallet Connect (Alby Hub, LNbits, coinos, own node)
  - `lndhub://login:password@https://host`: LNDHub account (BlueWallet format, custodial)
- Lightning invoices (receive / send), LNURL-pay, LNURL-withdraw and Lightning addresses
- Cashu ecash with its own recovery words
- QR scanner and NFC: tap a payment tag, a merchant's phone or a Bolt Card to pay or withdraw (Android)
- LND: channels (list, open, close, force close, rebalance), routing dashboard, on-chain receive and send with fee selection, BIP21
- Built-in Tor: onion nodes always over Tor, optionally all traffic
- Transaction history with search, notes, contacts and CSV export
- App lock with 6-digit PIN (shuffled keypad), optional biometrics, payment PIN limit and a duress PIN that opens a decoy wallet
- Encrypted backup and restore
- Amounts in sats or BTC with fiat value in many currencies, balance hiding
- Two UI styles (terminal and Fujin) with many themes
- Android home screen widget and payment links
- Desktop app for Windows, macOS and Linux
- Nine languages: English, German, Spanish, French, Italian, Portuguese, Japanese, Chinese, Russian

## Tech stack

- [React Native](https://reactnative.dev/) + TypeScript, built with [Expo](https://expo.dev/) (Expo Router)
- Backends live in `src/lightning/` behind one interface (`types.ts`)
- `modules/raijin-tor`: local Expo module (Android) with the embedded Tor daemon
  ([tor-android](https://github.com/guardianproject/tor-android), BSD-3) and an OkHttp client
  for SOCKS and node certificates. All HTTP goes through `src/lightning/http.ts`.

## Documentation

Architecture, building, security and development notes: [docs/](docs/README.md).

## Development

```bash
npm install
npx expo run:android   # development build
npx tsc --noEmit       # typecheck
npx expo lint          # lint
```

## License

Raijin is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

The name "Raijin" and its logo are not covered by the license. Forks must use a different name.
