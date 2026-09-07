import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { StrKey } from '@stellar/stellar-sdk';
import * as cose from '@emurgo/cardano-message-signing-nodejs';
import { bech32 } from '@scure/base';
import { chains, requirementsFor, canonicalMessage } from 'connect-protocol';
import {
	ProfileRegistry,
	stellarMessageHash,
	defineSigningProfile,
} from '../dist/index.js';
import { fixtureChallenge } from './helpers.mjs';
import { chainSigner } from './multichain-helpers.mjs';
test('published SEP-53 Hello World vector verifies with the prescribed digest', () => {
	const key = StrKey.decodeEd25519PublicKey(
		'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L',
	);
	const sig = Buffer.from(
		'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==',
		'base64',
	);
	assert.equal(
		ed25519.verify(
			sig,
			stellarMessageHash(new TextEncoder().encode('Hello, World!')),
			key,
			{ zip215: false },
		),
		true,
	);
});
test('Cardano accepts independent Emurgo CIP-8 signatures', async () => {
	const c = {
			...fixtureChallenge(),
			requirements: requirementsFor([chains.cardano]),
		},
		wallet = await chainSigner(chains.cardano);
	const proof = await wallet.proof(c),
		seed = Buffer.alloc(32, 1);
	const protectedMap = cose.HeaderMap.new();
	protectedMap.set_algorithm_id(
		cose.Label.from_algorithm_id(cose.AlgorithmId.EdDSA),
	);
	protectedMap.set_header(
		cose.Label.new_text('address'),
		cose.CBORValue.new_bytes(
			bech32.fromWords(bech32.decode(wallet.account.address, 128).words),
		),
	);
	const unprotected = cose.HeaderMap.new();
	unprotected.set_header(
		cose.Label.new_text('hashed'),
		cose.CBORValue.new_special(cose.CBORSpecial.new_bool(false)),
	);
	const headers = cose.Headers.new(
		cose.ProtectedHeaderMap.new(protectedMap),
		unprotected,
	);
	const builder = cose.COSESign1Builder.new(
		headers,
		new TextEncoder().encode(canonicalMessage(c, wallet)),
		false,
	);
	const signature = builder.build(
		ed25519.sign(builder.make_data_to_sign().to_bytes(), seed),
	);
	try {
		assert.deepEqual(
			await new ProfileRegistry().get(chains.cardano.profile).verify(c, {
				...proof,
				signature: Buffer.from(signature.to_bytes()).toString('hex'),
			}),
			wallet.account,
		);
	} finally {
		signature.free();
		builder.free();
		headers.free();
		protectedMap.free();
		unprotected.free();
	}
});
test('custom verifier adapters require explicit true results', async () => {
	const c = fixtureChallenge(),
		proof = {
			...c,
			profile: 'test',
			alg: null,
			account: { namespace: 'test', reference: '1', address: 'key' },
			signature: '00',
		};
	const p = defineSigningProfile({
		id: 'test',
		namespace: 'test',
		alg: null,
		validateAccount: () => true,
		verify: () => ({ valid: false }),
	});
	await assert.rejects(p.verify(c, proof));
});
