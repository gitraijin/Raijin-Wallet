# Security

## Secrets on the device

- Node connection strings, the Cashu seed and proofs live only in secure storage (`expo-secure-store` on phones, the OS keychain on desktop), never in plain app storage.
- No analytics, no crash reporting, no account. Fiat prices come from mempool.space and blockchain.info (over Tor when "route everything over Tor" is on).

## App lock and PIN

- 6-digit PIN with a shuffled keypad and salted hash; after 5 failed attempts each further failure doubles a lockout (30 s up to 1 h). Optional biometrics.
- **Payment PIN limit** (`pinLimit`: always, 1,000, 10,000 (default), 100,000 sat or never): above the limit, a payment asks for PIN or biometrics in addition to the hold-to-confirm gesture. Loosening the limit or turning off screen protection requires the PIN.
- **Screen protection** (on by default): Android `FLAG_SECURE`, desktop `setContentProtection`. Screens with recovery words are always protected.

## Duress PIN

A second PIN opens a **completely separate, empty wallet**.

- After unlocking with the duress PIN, every wallet key is read and written under a separate namespace (`src/lib/storage-namespace.ts`): nodes, Cashu (its own seed), contacts, notes, widget data and history are separate. Only the PIN, biometrics, display settings and theme are shared, so the app looks the same.
- `verifyPin` always computes both hashes, so timing does not reveal which PIN was entered.
- Biometrics always open the real wallet. The duress PIN never confirms a payment in the real wallet.
- Limits: the home screen widget and background notifications run without unlocking and show the real wallet. Forensic inspection of storage can see that two areas exist.

## Encrypted backup

`src/backup/backup.ts`

- **Contents:** nodes and connection strings, settings, theme, contacts, payment notes, Cashu (mints, proofs, history, seed, counters). Not included: PIN, duress PIN, biometrics.
- **Crypto:** `scrypt` (N = 2^15, r = 8, p = 1, 16-byte salt) → 32-byte key; XChaCha20-Poly1305 with a random 24-byte nonce (`@noble/ciphers`, `@noble/hashes`). The file header (format, KDF parameters, nonce, date) is authenticated as AAD. Password: at least 10 characters.
- **Restore merges** instead of overwriting: nodes, mints, contacts and history are united by id, proofs are united (no ecash is lost), counters take the maximum (never backwards), local notes win. If the device has *different* Cashu words, restore stops before changing anything.

## Tor

- Android: the embedded Tor daemon from [tor-android](https://github.com/guardianproject/tor-android) in `modules/raijin-tor`, with an OkHttp client over SOCKS. Desktop: a bundled Tor binary.
- `.onion` nodes always use Tor; "route everything over Tor" covers all HTTP, price lookups and NWC relays (`src/net/websocket.ts` swaps in a Tor-backed WebSocket).
- Node certificates: a self-signed certificate carried in `lndconnect://…?cert=` is pinned; public certificates are checked against the system CAs.

## Reporting a vulnerability

Please report security issues privately via Nostr to RaijinHub (`npub1vu0cdglzl5l40gcyg5wlfgup4c5zfgp39kaydmzjs5vmrwpz6m3sucjhpf`) rather than in a public issue.
