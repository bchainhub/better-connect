import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	validateWalletAccount,
	isValidWalletAccount,
	ConnectEngine,
	MemoryRequestStore,
	ProfileRegistry,
} from '../dist/index.js';
const cases = JSON.parse(
	await readFile(new URL('./fixtures/wallet-validation.json', import.meta.url)),
);
for (const c of cases)
	test(`address: ${c.name}`, () => {
		assert.equal(validateWalletAccount(c.account).status, c.status);
		assert.equal(isValidWalletAccount(c.account), c.status === 'valid');
	});
test('engine rejects malformed addresses even if custom profile accepts them', async () => {
	let verified = 0;
	const account = cases.find(
		(c) => c.name === 'EVM bad mixed checksum',
	).account;
	const profile = {
		id: 'test-evm',
		namespace: 'eip155',
		alg: null,
		validateAccount: () => true,
		verify: async (_c, p) => {
			verified++;
			return p.account;
		},
	};
	const store = new MemoryRequestStore();
	const engine = new ConnectEngine({
		origin: 'https://example.com',
		store,
		registry: new ProfileRegistry([profile]),
		requirements: [
			{ namespace: 'eip155', reference: '1', profile: 'test-evm', alg: null },
		],
	});
	const created = await engine.create();
	await assert.rejects(
		engine.approve({
			requestId: created.requestId,
			account,
			profile: 'test-evm',
			alg: null,
			signature: 'test',
		}),
		(e) => e.code === 'unsupportedAccount',
	);
	assert.equal(verified, 0);
	assert.equal((await engine.status(created.requestId)).status, 'PENDING');
	// A valid address still cannot bypass cryptographic proof verification.
	const rejecting = {
		...profile,
		verify: async () => {
			throw new Error('bad signature');
		},
	};
	const other = new ConnectEngine({
		origin: 'https://example.com',
		store: new MemoryRequestStore(),
		registry: new ProfileRegistry([rejecting]),
		requirements: [
			{ namespace: 'eip155', reference: '1', profile: 'test-evm', alg: null },
		],
	});
	const pending = await other.create();
	await assert.rejects(
		other.approve({
			requestId: pending.requestId,
			account: cases.find((c) => c.name === 'ethereum-siwe').account,
			profile: 'test-evm',
			alg: null,
			signature: 'test',
		}),
		(e) => e.code === 'invalidProof',
	);
});
