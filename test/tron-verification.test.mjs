import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { Trx } from 'tronweb';
import {
	chains,
	requirementsFor,
	canonicalMessage,
} from '../dist/protocol/index.js';
import { tronProfile } from '../dist/index.js';
import { fixtureChallenge } from './helpers.mjs';
import { chainSigner } from './multichain-helpers.mjs';
const challenge = {
	...fixtureChallenge(),
	requirements: requirementsFor([chains.tron]),
};
test('standalone TRON verification agrees with independent TronWeb signatures', async () => {
	for (const seed of [1, 2, 3, 7]) {
		const signer = await chainSigner(chains.tron, seed),
			proof = await signer.proof(challenge);
		assert.equal(
			Trx.verifyMessageV2(
				new TextEncoder().encode(canonicalMessage(challenge, proof)),
				proof.signature,
			),
			proof.account.address,
		);
		assert.deepEqual(await tronProfile.verify(challenge, proof), proof.account);
		const v = parseInt(proof.signature.slice(-2), 16);
		const compactV =
			proof.signature.slice(0, -2) + (v - 27).toString(16).padStart(2, '0');
		assert.deepEqual(
			await tronProfile.verify(challenge, { ...proof, signature: compactV }),
			proof.account,
		);
	}
});
test('TRON verification rejects Ethereum message prefixes and malformed address checksums', async () => {
	const signer = await chainSigner(chains.tron, 1),
		proof = await signer.proof(challenge);
	const eth = new Wallet('0x' + '01'.repeat(32));
	const signature = await eth.signMessage(
		new TextEncoder().encode(canonicalMessage(challenge, proof)),
	);
	await assert.rejects(
		tronProfile.verify(challenge, {
			...proof,
			signature: signature.toLowerCase(),
		}),
	);
	const address =
		proof.account.address.slice(0, -1) +
		(proof.account.address.endsWith('1') ? '2' : '1');
	assert.equal(
		tronProfile.validateAccount({ ...proof.account, address }),
		false,
	);
	await assert.rejects(
		tronProfile.verify(challenge, {
			...proof,
			account: { ...proof.account, address },
		}),
	);
});
