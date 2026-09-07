import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ConnectEngine,
	MemoryRequestStore,
	ProfileRegistry,
} from '../dist/index.js';
import { canonicalMessage, ConnectClient } from 'connect-protocol';
import { requirements, signer, fixtureChallenge, now } from './helpers.mjs';
const setup = () => {
	let time = Date.now();
	const store = new MemoryRequestStore();
	const engine = new ConnectEngine({
		origin: 'https://example.com',
		requirements,
		store,
		now: () => time,
	});
	return { engine, store, advance: () => (time += 300000) };
};
for (const requirement of requirements) {
	test(`${requirement.profile}: valid proof, wrong-key injection, signature mutation, replay`, async () => {
		const { engine } = setup(),
			created = await engine.create(),
			c = await engine.challenge(created.requestId);
		const alice = signer(requirement.profile, 1),
			bob = signer(requirement.profile, 2),
			proof = await alice.proof(c),
			attacker = await bob.proof(c);
		await assert.rejects(
			engine.approve({ ...attacker, account: alice.account }),
		);
		const forged = await bob.sign(
			new TextEncoder().encode(canonicalMessage(c, alice)),
		);
		await assert.rejects(engine.approve({ ...proof, ...forged }));
		await assert.rejects(
			engine.approve({
				...proof,
				signature: proof.signature.slice(0, -4) + 'AAAA',
			}),
		);
		await assert.rejects(
			engine.approve({
				...proof,
				alg: requirement.alg === null ? -47 : Math.abs(requirement.alg),
			}),
		);
		await assert.rejects(engine.approve({ ...proof, profile: 'unknown' }));
		await assert.rejects(
			engine.approve({
				...proof,
				account: { ...proof.account, address: 'invalid' },
			}),
		);
		assert.equal((await engine.approve(proof)).status, 'APPROVED');
		await assert.rejects(engine.approve(proof));
		await assert.rejects(engine.redeem(created.requestId, 'f'.repeat(64)));
		assert.deepEqual(
			await engine.redeem(created.requestId, created.redeemSecret),
			alice.account,
		);
		await assert.rejects(
			engine.redeem(created.requestId, created.redeemSecret),
		);
	});
	test(`${requirement.profile}: all canonical fields are authenticated`, async () => {
		const p = new ProfileRegistry().get(requirement.profile),
			c = fixtureChallenge(),
			wallet = signer(requirement.profile),
			proof = await wallet.proof(c);
		for (const [key, value] of Object.entries({
			domain: 'evil.com',
			origin: 'https://evil.com',
			nonce: 'c'.repeat(64),
			requestId: 'd'.repeat(64),
			issuedAt: '2026-09-07T10:00:01.000Z',
			expiresAt: '2026-09-07T10:02:01.000Z',
		}))
			await assert.rejects(p.verify({ ...c, [key]: value }, proof), key);
	});
}
test('concurrent approval and double redemption have one winner', async () => {
	const { engine } = setup(),
		created = await engine.create(),
		c = await engine.challenge(created.requestId),
		proof = await signer('raw-ed25519').proof(c);
	const approvals = await Promise.allSettled(
		Array.from({ length: 8 }, () => engine.approve(proof)),
	);
	assert.equal(approvals.filter((x) => x.status === 'fulfilled').length, 1);
	const results = await Promise.allSettled(
		Array.from({ length: 8 }, () =>
			engine.redeem(created.requestId, created.redeemSecret),
		),
	);
	assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
});
test('pending/approved expiration, denied states, unknown request and secret separation', async () => {
	for (const approve of [false, true]) {
		const { engine, advance } = setup(),
			created = await engine.create();
		assert.ok(!created.connectUri.includes(created.redeemSecret));
		if (approve)
			await engine.approve(
				await signer('raw-ed25519').proof(
					await engine.challenge(created.requestId),
				),
			);
		advance();
		assert.equal((await engine.status(created.requestId)).status, 'EXPIRED');
		await assert.rejects(
			engine.redeem(created.requestId, created.redeemSecret),
		);
	}
	const { engine } = setup(),
		c = await engine.create();
	await assert.rejects(engine.deny(c.requestId, 'f'.repeat(64)));
	await engine.deny(c.requestId, c.redeemSecret);
	await assert.rejects(engine.challenge(c.requestId));
	await assert.rejects(engine.challenge('e'.repeat(64)));
	await assert.rejects(engine.challenge(c.requestId + '\n'));
});
test('TS wallet completes QR approval and separate desktop redemption', async () => {
	const { engine } = setup(),
		created = await engine.create(),
		account = signer('xcb-ed448');
	const client = new ConnectClient(
		{ getAccounts: async () => [account] },
		{
			challenge: (t) => engine.challenge(t.requestId),
			approve: (_, p) => engine.approve(p),
		},
	);
	const request = await client.resolve(created.connectUri);
	assert.equal(request.state, 'awaitingUserApproval');
	await request.approve(request.accounts[0]);
	assert.equal(request.state, 'approved');
	assert.deepEqual(
		await engine.redeem(created.requestId, created.redeemSecret),
		account.account,
	);
});
