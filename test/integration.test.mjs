import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { betterConnect } from '../dist/index.js';
import { signer, requirements } from './helpers.mjs';
export async function makeAuth() {
	const database = new Database(':memory:');
	const options = {
		database,
		baseURL: 'https://example.com/api/auth',
		secret: 'test-only-secret-at-least-32-characters-long',
		plugins: [betterConnect({ origin: 'https://example.com', requirements })],
	};
	const migrations = await getMigrations(options);
	await migrations.runMigrations();
	const auth = betterAuth(options);
	const call = async (action, body, origin = 'https://example.com') => {
		const response = await auth.handler(
			new Request(`https://example.com/api/auth/wallet-connect/${action}`, {
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					...(body === undefined ? {} : { 'content-type': 'application/json' }),
					...(origin ? { origin } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
		);
		return { response, body: await response.json() };
	};
	return { auth, database, call };
}
test('real Better Auth SQLite: QR -> approval -> cookie -> authenticated desktop; concurrent redemption', async () => {
	const { auth, database, call } = await makeAuth();
	try {
		assert.equal(
			(await call('create', {}, 'https://evil.com')).response.status,
			403,
		);
		const { body: created, response: createResponse } = await call(
			'create',
			{},
		);
		assert.equal(createResponse.status, 200, JSON.stringify(created));
		assert.equal(createResponse.headers.get('cache-control'), 'no-store');
		const { body: challenge } = await call(
			`challenge?requestId=${created.requestId}`,
		);
		const proof = await signer('xcb-ed448').proof(challenge);
		const approval = await call('approve', proof, null);
		assert.equal(approval.response.status, 200, JSON.stringify(approval.body));
		assert.equal(approval.response.headers.get('set-cookie'), null);
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				call('redeem', {
					requestId: created.requestId,
					redeemSecret: created.redeemSecret,
				}),
			),
		);
		const winners = results.filter((r) => r.response.status === 200);
		assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.body)));
		const cookie = winners[0].response.headers.get('set-cookie');
		assert.ok(cookie?.includes('HttpOnly'));
		assert.ok(cookie?.includes('Secure'));
		assert.ok(!JSON.stringify(winners[0].body).includes('token'));
		const session = await auth.handler(
			new Request('https://example.com/api/auth/get-session', {
				headers: { cookie: cookie.split(';')[0] },
			}),
		);
		const data = await session.json();
		assert.equal(data.user.id, winners[0].body.user.id);
		assert.equal(
			database.prepare('select count(*) as n from session').get().n,
			1,
		);
		const again = (await call('create', {})).body,
			c = (await call(`challenge?requestId=${again.requestId}`)).body;
		await call('approve', await signer('xcb-ed448').proof(c), null);
		const second = await call('redeem', {
			requestId: again.requestId,
			redeemSecret: again.redeemSecret,
		});
		assert.equal(second.body.user.id, data.user.id);
		assert.equal(
			database.prepare('select count(*) as n from connectWallet').get().n,
			1,
		);
	} finally {
		database.close();
	}
});

test('Better Auth client plugin routes and concurrent first-time wallet mapping', async () => {
	const { createAuthClient } = await import('better-auth/client');
	const { betterConnectClient } = await import('../dist/client.js');
	const { auth, database, call } = await makeAuth();
	try {
		const client = createAuthClient({
			baseURL: 'https://example.com',
			plugins: [betterConnectClient()],
			fetchOptions: {
				customFetchImpl: (url, init) =>
					auth.handler(
						new Request(url, {
							...init,
							headers: {
								...Object.fromEntries(new Headers(init?.headers)),
								origin: 'https://example.com',
							},
						}),
					),
			},
		});
		const first = await client.walletConnect.create({});
		assert.equal(first.error, null, JSON.stringify(first.error));
		const challenge = await client.walletConnect.challenge({
			query: { requestId: first.data.requestId },
		});
		assert.equal(challenge.data.requestId, first.data.requestId);
		const wallet = signer('raw-ed25519', 7);
		await client.walletConnect.approve(await wallet.proof(challenge.data));
		const status = await client.walletConnect.status({
			query: { requestId: first.data.requestId },
		});
		assert.equal(status.data.status, 'APPROVED');
		const second = (await call('create', {})).body;
		await call(
			'approve',
			await wallet.proof(
				(await call(`challenge?requestId=${second.requestId}`)).body,
			),
		);
		const results = await Promise.all([
			client.walletConnect.redeem({
				requestId: first.data.requestId,
				redeemSecret: first.data.redeemSecret,
			}),
			client.walletConnect.redeem({
				requestId: second.requestId,
				redeemSecret: second.redeemSecret,
			}),
		]);
		for (const result of results)
			assert.equal(result.error, null, JSON.stringify(result.error));
		assert.equal(results[0].data.user.id, results[1].data.user.id);
		assert.equal(
			database.prepare('select count(*) as n from connectWallet').get().n,
			1,
		);
		assert.equal(database.prepare('select count(*) as n from user').get().n, 1);
	} finally {
		database.close();
	}
});

test('offline wallet handoff creates a verified Better Auth session through the portal', async () => {
	const { createBetterConnectHandoff } = await import('../dist/client.js');
	const { parseConnectHandoff } = await import('connect.js');
	const { auth, database, call } = await makeAuth();
	try {
		let approvals = 0;
		const handoff = await createBetterConnectHandoff({
			async create() {
				const r = await call('create', {});
				assert.equal(r.response.status, 200);
				return r.body;
			},
			async approve(proof) {
				approvals++;
				const r = await call('approve', proof);
				assert.equal(r.response.status, 200, JSON.stringify(r.body));
			},
			async redeem(credentials) {
				const r = await call('redeem', credentials);
				assert.equal(r.response.status, 200);
				return r.response.headers.get('set-cookie');
			},
		});
		const wallet = parseConnectHandoff(handoff.uri, 'https://example.com');
		const proof = await signer('xcb-ed448').proof(wallet.challenge);
		assert.equal(approvals, 0);
		const packet = await wallet.sealProof(proof);
		const cookie = await handoff.accept(packet);
		assert.match(cookie, /HttpOnly/);
		assert.match(cookie, /Secure/);
		const response = await auth.handler(
			new Request('https://example.com/api/auth/get-session', {
				headers: { cookie: cookie.split(';')[0] },
			}),
		);
		assert.ok((await response.json()).user);
		assert.equal(approvals, 1);
		await assert.rejects(handoff.accept(packet));
	} finally {
		database.close();
	}
});
