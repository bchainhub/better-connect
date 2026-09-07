# Better Connect

Connect v1 multi-chain authentication for Better Auth. This package owns the backend request engine, HTTP endpoints, storage, users and sessions. It reuses signature profiles from the browser-only connect.js package and supplies its own Node Monero verifier.

A wallet proves control of its account and approves a pending request. The initiating browser redeems that approval with its private redemption secret to receive a fresh Better Auth session. The secret stays with that browser and never enters the wallet QR.

```ts
import { betterAuth } from 'better-auth';
import { betterConnect, allChains } from 'better-connect';

export const auth = betterAuth({
	database: yourDatabase,
	plugins: [betterConnect({origin: 'https://example.com', chains: allChains})],
});
```

Apply Better Auth migrations for the plugin's request and wallet-identity schema. Mount `auth.handler` using your framework's Better Auth integration. Configure HTTPS, trusted origins and rate limits for the deployment. See [protocol and security boundaries](docs/PROTOCOL.md).

```ts
import { createAuthClient } from 'better-auth/client';
import { betterConnectClient, createBetterConnectHandoff } from 'better-connect/client';
import { receiveBluetoothResponse } from 'connect.js';

const client = createAuthClient({ plugins: [betterConnectClient()] });
const handoff = await createBetterConnectHandoff({
  async create() {
    const result = await client.walletConnect.create({});
    if (result.error) throw result.error;
    return result.data;
  },
  async approve(proof) {
    const result = await client.walletConnect.approve(proof);
    if (result.error) throw result.error;
  },
  async redeem(credentials) {
    const result = await client.walletConnect.redeem(credentials);
    if (result.error) throw result.error;
    return result.data;
  },
});
// Display handoff.uri as QR or a connect:// link.
// In a subsequent Bluetooth button click:
const packet = await receiveBluetoothResponse(handoff.ticket);
const session = await handoff.accept(packet);
```

The wallet handles the embedded challenge and returns its encrypted signature without contacting Better Auth. The portal delivers that proof to the server for verification, then redeems approval. Any host-provided channel can return the packet. Completing a Better Auth session requires a reachable server. See [nearby/offline transport](docs/NEARBY.md).

Short-URI HTTP endpoints remain available for existing integrations. connect.js remains browser-only.

Built-in proof schemes cover Core Blockchain, Ethereum, Polygon, Base, Bitcoin, Solana, BNB Smart Chain, TRON, Monero, Stellar, Litecoin, XRP, Zcash and Cardano. See [chain methods and supported addresses](docs/CHAINS.md). Use `ProfileRegistry` and `defineSigningProfile` to extend verification. `MemoryRequestStore` is available for tests or single-process development; production adapters must implement atomic conditional transitions.

Verification binds origin, request ID, nonce, expiry, chain, account, profile and algorithm. Approval and redemption are single-use. Wallet identities are stored independently from email addresses; no unverified-email account linking occurs. Session cookies are created by Better Auth only after successful redemption.

```sh
node scripts/sync-protocol.mjs ../connect.js
npm run typecheck
npm run lint
npm test
npm run test:package
node scripts/flutter-interop.mjs ../flutter_connect
```

The package bundles connect.js and its own patched Node Monero dependency so consumers do not need local source checkouts. Shared fixtures and live Dart integration cover all seventeen proof variants. Generated vendor archives and dependency lockfiles are ignored. See [release setup](docs/RELEASE.md).

Licensed under [CORE License](LICENSE).
