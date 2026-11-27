# Architecture

## Core idea

Raijin holds **no keys of its own** for Lightning. Every "wallet" in the app is a connection to a system that runs elsewhere:

| Type | Connection string | What the app can do with it |
|---|---|---|
| LND REST | `lndconnect://host:port?cert=…&macaroon=…` | Everything: Lightning, channels, on-chain, history, routing |
| NWC | `nostr+walletconnect://…` | Send and receive Lightning, history |
| LNDHub | `lndhub://login:password@https://host` | Send and receive Lightning (custodial) |

A connection string grants spending rights and is as sensitive as a seed. It is stored only in the device's secure storage (`src/lib/secure-store.ts`: `expo-secure-store` on phones, the operating system keychain on desktop).

The one exception is **Cashu ecash**: the app keeps its own seed (12 words) and proofs, because ecash lives on the device.

## Layers

```text
┌─────────────────────────────────────────────────────────────┐
│ Screens (src/app)            use hooks and types only        │
├─────────────────────────────────────────────────────────────┤
│ WalletContext / useChannels  state of the active node        │
├─────────────────────────────────────────────────────────────┤
│ WalletBackend (types.ts)     backend-neutral interface       │
│   lnd.ts · nwc.ts · lndhub.ts · lnurl.ts                     │
├─────────────────────────────────────────────────────────────┤
│ http.ts                fetch | native module | desktop IPC   │
└─────────────────────────────────────────────────────────────┘
```

Rules:

1. **Screens do not know backends.** They only call `WalletBackend` methods (`backend.prepareSend(...)`, `backend.channels?.list()`).
2. **Optional capabilities are optional fields.** What only LND can do (`channels?`, `estimateFees?`, `prepareOnchainSend?`) is optional in the interface, and the UI hides a feature when the field is missing.
3. **All network access goes through `src/lightning/http.ts`.** That is what makes Tor apply everywhere.

## The backend interface

`src/lightning/types.ts` (shortened):

```ts
export interface WalletBackend {
  readonly info: BackendInfo;                 // label, network, sendTargets, onchainReceive
  getSnapshot(): Promise<WalletSnapshot>;     // balance, split, history
  createInvoice(request: { amountSats?: bigint; description: string }): Promise<Invoice>;
  getOnchainAddress(fresh: boolean): Promise<string>;
  readonly channels?: ChannelFeatures;        // only backends that control a node
  estimateFees?(): Promise<FeeEstimate[]>;
  prepareSend(request: { destination: string; amountSats?: bigint }): Promise<SendQuote>;
  prepareOnchainSend?(request: OnchainSendRequest): Promise<SendQuote>;
  subscribe(onChange: () => void): Promise<() => Promise<void> | void>;
  disconnect(): Promise<void>;
}
```

**Two-phase payments.** Every payment is first *prepared* (amount, fee, details for the confirmation screen) and then executed with `quote.confirm()`. Screens stay the same whether an invoice, an address or an LNURL is paid.

**Amounts** are `bigint` satoshis everywhere. `toSats()` in `http.ts` converts LND's int64 strings and numbers safely; display and parsing in the user's unit (sat/BTC) and fiat live in `src/preferences/useAmount.ts`.

## Folder layout

```text
src/
  app/            screens (Expo Router: one file per route)
  components/     shared UI (ui.tsx holds the building blocks)
  lightning/      backends and networking, no React: types, connection parsing, http, lnd*, nwc, lndhub, lnurl, bolt11
  cashu/          ecash: storage, operations, seed and counters, CashuContext
  backup/         encrypted backup and restore
  contacts/       address book
  export/         CSV export
  motion/         animations, haptics, payment events
  notify/         notifications and background checks
  widget/         Android home screen widget
  lib/            helpers: formatting, secure store (with the duress namespace), links, scanner, desktop bridge
  net/            Tor status, Tor-aware WebSocket (NWC over Tor)
  preferences/    settings, prices, amount formatting
  security/       PIN, duress PIN, biometrics, lock, screen protection, payment PIN limit
  wallet/         WalletContext, useChannels
  i18n/           en (source) + de, es, fr, it, pt, ja, zh, ru
modules/
  raijin-tor/     local native Expo module (Android): Tor daemon, HTTP client, WebSockets over Tor
                  index.web.ts: same interface for desktop
desktop/          Electron shell for Windows, macOS and Linux
plugins/          Expo config plugins (release signing)
```

## Desktop

The desktop app is the Expo web export inside Electron (`desktop/`). The Electron main process provides the same interfaces the Android native module offers: an HTTP client with certificate pinning (`net.cjs`), a bundled Tor (`tor.cjs`), the OS keychain (`secure.cjs`) and WebSockets over SOCKS (`websockets.cjs`). The renderer runs with context isolation and talks to them only through the preload bridge.
