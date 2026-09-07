import { ed448 } from '@noble/curves/ed448.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { privateKeyToAccount } from 'viem/accounts';
import { Signer } from 'bip322-js';
import { canonicalMessage } from 'connect.js';
import { xcbAddress } from '../dist/index.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('@bitcoinerlab/secp256k1');
export const now = Date.parse('2026-09-07T10:00:00.000Z');
const hex = (b) => Buffer.from(b).toString('hex');
export const requirements = [
	{ namespace: 'core', reference: '1', profile: 'xcb-ed448', alg: -53 },
	{ namespace: 'raw', reference: 'ed25519', profile: 'raw-ed25519', alg: -19 },
	{ namespace: 'eip155', reference: '1', profile: 'ethereum-siwe', alg: null },
	{
		namespace: 'bip122',
		reference: '000000000019d6689c085ae165831e93',
		profile: 'bitcoin-bip322-p2wpkh',
		alg: null,
	},
];
export function fixtureChallenge() {
	return {
		version: 1,
		requestId: 'a'.repeat(64),
		nonce: 'b'.repeat(64),
		domain: 'example.com',
		origin: 'https://example.com',
		issuedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 120000).toISOString(),
		requirements,
	};
}
export function signer(profile, byte = 1) {
	const r = requirements.find((r) => r.profile === profile);
	if (profile === 'xcb-ed448' || profile === 'raw-ed25519') {
		const curve = profile === 'xcb-ed448' ? ed448 : ed25519,
			seed = new Uint8Array(profile === 'xcb-ed448' ? 57 : 32).fill(byte),
			key = curve.getPublicKey(seed);
		const account = {
			namespace: r.namespace,
			reference: r.reference,
			address:
				profile === 'xcb-ed448' ? xcbAddress(key, r.reference) : hex(key),
		};
		const selection = { account, profile, alg: r.alg };
		return {
			...selection,
			publicKey: hex(key),
			seed: hex(seed),
			sign: async (bytes) => ({
				signature: hex(curve.sign(bytes, seed)),
				publicKey: hex(key),
			}),
			proof: async (c) => ({
				...selection,
				requestId: c.requestId,
				publicKey: hex(key),
				signature: hex(
					curve.sign(
						new TextEncoder().encode(canonicalMessage(c, selection)),
						seed,
					),
				),
			}),
		};
	}
	if (profile === 'ethereum-siwe') {
		const key = privateKeyToAccount(
				'0x' + byte.toString(16).padStart(2, '0').repeat(32),
			),
			selection = {
				account: {
					namespace: r.namespace,
					reference: r.reference,
					address: key.address,
				},
				profile,
				alg: null,
			};
		return {
			...selection,
			sign: async (bytes) => ({
				signature: await key.signMessage({ message: { raw: bytes } }),
			}),
			proof: async (c) => ({
				...selection,
				requestId: c.requestId,
				signature: await key.signMessage({
					message: canonicalMessage(c, selection),
				}),
			}),
		};
	}
	const key = ECPairFactory(ecc).fromPrivateKey(Buffer.alloc(32, byte));
	const address = bitcoin.payments.p2wpkh({
		pubkey: Buffer.from(key.publicKey),
	}).address;
	const selection = {
		account: { namespace: r.namespace, reference: r.reference, address },
		profile,
		alg: null,
	};
	return {
		...selection,
		sign: async (bytes) => ({
			signature: Signer.sign(
				key.toWIF(),
				address,
				new TextDecoder().decode(bytes),
			),
		}),
		proof: async (c) => ({
			...selection,
			requestId: c.requestId,
			signature: Signer.sign(
				key.toWIF(),
				address,
				canonicalMessage(c, selection),
			),
		}),
	};
}
