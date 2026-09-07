import {
	ConnectHandoff,
	ConnectError,
	type Challenge,
	type Proof,
} from 'connect.js';
import type { BetterAuthClientPlugin } from 'better-auth/client';
import type { betterConnect } from './index.js';
export function betterConnectClient() {
	return {
		id: 'better-connect',
		fetchPlugins: [
			{
				id: 'connect-wire-json',
				name: 'Preserve Connect canonical timestamp strings',
				hooks: {
					onRequest(context) {
						if (
							new URL(
								context.url.toString(),
								'https://connect.invalid',
							).pathname.startsWith('/api/auth/wallet-connect/')
						) {
							return { ...context, jsonParser: JSON.parse };
						}
					},
				},
			},
		],
		$InferServerPlugin: {} as ReturnType<typeof betterConnect>,
		pathMethods: {
			'/wallet-connect/create': 'POST',
			'/wallet-connect/approve': 'POST',
			'/wallet-connect/redeem': 'POST',
			'/wallet-connect/deny': 'POST',
			'/wallet-connect/status': 'GET',
			'/wallet-connect/challenge': 'GET',
		},
		atomListeners: [
			{
				matcher: (path: string) => path === '/wallet-connect/redeem',
				signal: '$sessionSignal',
			},
		],
	} satisfies BetterAuthClientPlugin;
}

/** Adapt the Better Auth client (or another caller) without making the wallet contact the server. */
export async function createBetterConnectHandoff<T>(api: {
	create(): Promise<{
		requestId: string;
		redeemSecret: string;
		challenge: Challenge;
	}>;
	approve(proof: Proof): Promise<void>;
	redeem(credentials: { requestId: string; redeemSecret: string }): Promise<T>;
}) {
	const created = await api.create();
	if (created.challenge.requestId !== created.requestId)
		throw new ConnectError('invalidHandoff');
	const ticket = new ConnectHandoff(created.challenge);
	let busy = false,
		done = false,
		approvedProof: string | undefined;
	return Object.freeze({
		ticket,
		uri: ticket.uri,
		async accept(response: string): Promise<T> {
			if (busy || done) throw new ConnectError('invalidState');
			busy = true;
			try {
				const proof = await ticket.openProof(response),
					fingerprint = JSON.stringify(proof);
				if (approvedProof && approvedProof !== fingerprint)
					throw new ConnectError('invalidProof');
				if (!approvedProof) {
					await api.approve(proof);
					approvedProof = fingerprint;
				}
				const session = await api.redeem({
					requestId: created.requestId,
					redeemSecret: created.redeemSecret,
				});
				done = true;
				return session;
			} finally {
				busy = false;
			}
		},
	});
}
