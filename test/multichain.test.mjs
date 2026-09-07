import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	allChains,
	chains,
	requirementsFor,
	canonicalMessage,
	ConnectClient,
	evmChain,
	accountFor,
} from 'connect.js';
import {
	ConnectEngine,
	MemoryRequestStore,
	ProfileRegistry,
	builtInProfiles,
	defineSigningProfile,
} from '../dist/index.js';
import {
	chainSigner,
	closeWallets,
	cardanoSign,
	moneroViewSignature,
} from './multichain-helpers.mjs';
import { fixtureChallenge } from './helpers.mjs';
import { decode, encode } from 'cborg';
import { bech32 } from '@scure/base';
after(closeWallets);
for (const chain of allChains) {
	test(`${chain.name}: wallet approval, address binding, canonical fields, replay`, async () => {
		const alice = await chainSigner(chain),
			bob = await chainSigner(chain, 2);
		const engine = new ConnectEngine({
			origin: 'https://example.com',
			chains: allChains,
			store: new MemoryRequestStore(),
		});
		const created = await engine.create(),
			c = await engine.challenge(created.requestId),
			proof = await alice.proof(c),
			registry = new ProfileRegistry().get(chain.profile);
		assert.equal(registry.validateAccount(alice.account), true);
		const forged = await bob.sign(
			new TextEncoder().encode(canonicalMessage(c, alice)),
		);
		await assert.rejects(engine.approve({ ...proof, ...forged }));
		await assert.rejects(engine.approve({ ...proof, account: bob.account }));
		for (const [field, value] of Object.entries({
			domain: 'evil.com',
			origin: 'https://evil.com',
			nonce: 'e'.repeat(64),
			requestId: 'f'.repeat(64),
			issuedAt: '2026-09-07T10:00:01.000Z',
			expiresAt: '2026-09-07T10:02:01.000Z',
		}))
			await assert.rejects(
				registry.verify({ ...c, [field]: value }, proof),
				field,
			);
		await assert.rejects(
			engine.approve({
				...proof,
				account: { ...proof.account, reference: 'wrong-network' },
			}),
		);
		await assert.rejects(engine.approve({ ...proof, alg: 123 }));
		await assert.rejects(
			engine.approve({
				...proof,
				signature: proof.signature.slice(0, -4) + 'AAAA',
			}),
		);
		await assert.rejects(
			engine.approve({ ...proof, publicKey: '00'.repeat(32) }),
		);
		const client = new ConnectClient(
			{ getAccounts: async () => [alice] },
			{
				challenge: (t) => engine.challenge(t.requestId),
				approve: (_, p) => engine.approve(p),
			},
		);
		const request = await client.resolve(created.connectUri);
		await request.approve(request.accounts[0]);
		assert.equal(request.state, 'approved');
		await assert.rejects(engine.approve(proof));
		assert.deepEqual(
			await engine.redeem(created.requestId, created.redeemSecret),
			alice.account,
		);
		await assert.rejects(
			engine.redeem(created.requestId, created.redeemSecret),
		);
	});
}
test('EVM extensions and custom profiles preserve built-ins and bind chain IDs', async () => {
	const arbitrum = evmChain('Arbitrum', 42161),
		alice = await chainSigner(arbitrum),
		c = {
			...fixtureChallenge(),
			requirements: requirementsFor([
				...allChains,
				evmChain('Arbitrum', 42161),
			]),
		},
		proof = await alice.proof(c),
		p = new ProfileRegistry().get(arbitrum.profile);
	assert.deepEqual(await p.verify(c, proof), alice.account);
	await assert.rejects(
		p.verify(c, { ...proof, account: { ...proof.account, reference: '1' } }),
	);
	assert.throws(() => evmChain('invalid', -1));
	assert.throws(() => evmChain('invalid', 1.5));
	const extension = defineSigningProfile({
		id: 'custom',
		namespace: 'custom',
		alg: -19,
		validateAccount: () => false,
		verify: () => false,
	});
	assert.equal(
		new ProfileRegistry([...builtInProfiles, extension]).get('custom'),
		extension,
	);
	assert.throws(
		() => new ProfileRegistry([...builtInProfiles, builtInProfiles[0]]),
	);
	assert.equal(requirementsFor([chains.solana, chains.solana]).length, 1);
});
test('Cardano COSE headers, credentials, hash mode and network are enforced', async () => {
	const alice = await chainSigner(chains.cardano),
		c = {
			...fixtureChallenge(),
			requirements: requirementsFor([
				...allChains,
				evmChain('Arbitrum', 42161),
			]),
		},
		proof = await alice.proof(c),
		profile = new ProfileRegistry().get(chains.cardano.profile);
	const raw = bech32.fromWords(bech32.decode(alice.account.address, 128).words),
		bytes = new TextEncoder().encode(canonicalMessage(c, alice));
	assert.deepEqual(
		await profile.verify(c, {
			...proof,
			...cardanoSign(bytes, Buffer.alloc(32, 1), raw, true),
		}),
		alice.account,
	);
	const mutate = async (fn) => {
		const parts = decode(Buffer.from(proof.signature, 'hex'), {
			useMaps: true,
		});
		fn(parts);
		await assert.rejects(
			profile.verify(c, {
				...proof,
				signature: Buffer.from(encode(parts)).toString('hex'),
			}),
		);
	};
	await mutate((parts) => parts[1].set('hashed', true));
	await mutate((parts) => {
		const h = decode(parts[0], { useMaps: true });
		h.set(1, -7);
		parts[0] = encode(h);
	});
	await mutate((parts) => {
		const h = decode(parts[0], { useMaps: true });
		h.set('address', new Uint8Array(29));
		parts[0] = encode(h);
	});
	for (const first of [0x60, 0x71, 0xe0]) {
		const bad = Uint8Array.from(raw);
		bad[0] = first;
		assert.equal(
			profile.validateAccount({
				...alice.account,
				address: bech32.encode('addr', bech32.toWords(bad), 128),
			}),
			false,
		);
	}
});
test('Monero view-key signatures cannot authenticate spending identities', async () => {
	const alice = await chainSigner(chains.monero),
		c = {
			...fixtureChallenge(),
			requirements: requirementsFor([
				...allChains,
				evmChain('Arbitrum', 42161),
			]),
		},
		proof = await alice.proof(c);
	const signature = await moneroViewSignature(
		new TextEncoder().encode(canonicalMessage(c, alice)),
	);
	await assert.rejects(
		new ProfileRegistry()
			.get(chains.monero.profile)
			.verify(c, { ...proof, signature }),
	);
});

test('server chain selection is explicit and rejects ambiguous policy', () => {
	const base = {
		origin: 'https://example.com',
		store: new MemoryRequestStore(),
	};
	assert.throws(() => new ConnectEngine(base));
	assert.throws(
		() =>
			new ConnectEngine({
				...base,
				chains: allChains,
				requirements: requirementsFor(allChains),
			}),
	);
	assert.doesNotThrow(
		() => new ConnectEngine({ ...base, chains: [chains.solana] }),
	);
});
