# Better Connect

Connect v1 multi-chain authentication for Better Auth. This package owns the backend request engine, HTTP endpoints, storage, users and sessions. It owns its authentication schemas, canonical messages and Node signature verifiers. It installs and builds independently of connect.js and flutter_connect.

A wallet proves control of its account and approves a pending request. The initiating browser redeems that approval with its private redemption secret to receive a fresh Better Auth session. The secret stays with that browser and never enters the wallet QR.

```ts
import { betterAuth } from 'better-auth';
import { betterConnect, allChains } from 'better-connect';

export const auth = betterAuth({
  database: yourDatabase,
  plugins: [betterConnect({origin: 'https://example.com', chains: allChains})],
});
```

Apply Better Auth migrations for the plugin's request and wallet-identity schema. Mount `auth.handler` using your framework's Better Auth integration. Configure HTTPS, trusted origins and rate limits for the deployment. See [protocol and security boundaries](docs/protocol.md).

```ts
import { createAuthClient } from 'better-auth/client';
import { betterConnectClient, createBetterConnectHandoff } from 'better-connect/client';

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
// Receive the encrypted packet through your application transport.
const packet = await yourTransport.receive(handoff.ticket);
const session = await handoff.accept(packet);
```

The wallet handles the embedded challenge and returns its encrypted signature without contacting Better Auth. The portal delivers that proof to the server for verification, then redeems approval. Any host-provided channel can return the packet. Completing a Better Auth session requires a reachable server. See [nearby/offline transport](docs/nearby.md).

Short-URI HTTP endpoints remain available for existing integrations.

Built-in proof schemes cover Core Blockchain, Ethereum, Polygon, Base, Bitcoin, Solana, BNB Smart Chain, TRON, Monero, Stellar, Litecoin, XRP, Zcash and Cardano. See [chain methods and supported addresses](docs/chains.md). Use `ProfileRegistry` and `defineSigningProfile` to extend verification. `MemoryRequestStore` is available for tests or single-process development; production adapters must implement atomic conditional transitions.

Verification binds origin, request ID, nonce, expiry, chain, account, profile and algorithm. Approval and redemption are single-use. Wallet identities are stored independently from email addresses; no unverified-email account linking occurs. Session cookies are created by Better Auth only after successful redemption.

```sh
npm install --package-lock=false
npm run typecheck
npm run lint
npm test
npm run test:package
node scripts/flutter-interop.mjs ../flutter_connect
```

The package has no connect-protocol dependency, Git source pin or sibling checkout requirement. Its Node Monero and compatible BIP-322 dependencies are bundled; TRON verification uses local TIP-191 framing with Ethers recovery. Shared fixtures and live Dart integration cover all seventeen proof variants. Dependency lockfiles are ignored. See [release setup](docs/release.md).

Licensed under [CORE License](LICENSE).

This package is distributed under the [CORE License](LICENSE). It is not an OSI-approved license.

## Wallet address validation

`validateWalletAccount` checks addresses against an explicit Connect namespace/reference and returns `valid`, `invalid`, or `unsupported`. `isValidWalletAccount` accepts only `valid`. These checks supplement wallet ownership verification. See [coverage, adapter integration and package compatibility](docs/wallet_validation.md).

## License

Licensed under the [CORE License](LICENSE).
