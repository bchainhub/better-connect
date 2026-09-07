import { createAuthClient } from 'better-auth/client';
import { betterConnectClient } from '../src/client.js';
const client = createAuthClient({ plugins: [betterConnectClient()] });
async function typedFlow() {
	const result = await client.walletConnect.create({});
	if (result.error) return;
	const { requestId, redeemSecret } = result.data;
	await client.walletConnect.challenge({ query: { requestId } });
	await client.walletConnect.status({ query: { requestId } });
	await client.walletConnect.redeem({ requestId, redeemSecret });
	// @ts-expect-error A public request ID alone cannot redeem an approval.
	await client.walletConnect.redeem({ requestId });
}
void typedFlow;

async function typedNearbyFlow() {
	const { createBetterConnectHandoff } = await import('../src/client.js');
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
	return handoff;
}
void typedNearbyFlow;
