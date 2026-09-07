import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { base58, base58check, bech32 } from '@scure/base';
import { Keypair } from '@stellar/stellar-sdk';
import * as ripple from 'ripple-keypairs';
import bitcoinMessage from 'bitcoinjs-message';
import { Trx, TronWeb } from 'tronweb';
import { encode } from 'cborg';
import { accountFor, canonicalMessage } from 'connect-protocol';
import { signer } from './helpers.mjs';
const hex = (b) => Buffer.from(b).toString('hex');
const wallets = new Map();
export async function closeWallets() {
	for (const wallet of wallets.values()) await wallet.close();
	wallets.clear();
	if (monero) await monero.shutdown();
}
let monero;
export async function chainSigner(chain, byte = 1) {
	const seed = Buffer.alloc(32, byte),
		key = ed25519.getPublicKey(seed);
	let address, sign;
	if (
		['xcb-ed448', 'ethereum-siwe', 'bitcoin-bip322-p2wpkh'].includes(
			chain.profile,
		)
	) {
		const old = signer(chain.profile, byte);
		address = old.account.address;
		sign = old.sign;
	} else if (chain.profile === 'solana-ed25519') {
		address = base58.encode(key);
		sign = async (bytes) => ({ signature: hex(ed25519.sign(bytes, seed)) });
	} else if (chain.profile === 'stellar-sep53') {
		const pair = Keypair.fromRawEd25519Seed(seed);
		address = pair.publicKey();
		sign = async (bytes) => ({
			signature: hex(
				pair.sign(
					Buffer.from(
						sha256(
							Buffer.concat([Buffer.from('Stellar Signed Message:\n'), bytes]),
						),
					),
				),
			),
		});
	} else if (chain.profile === 'tron-signmessage-v2') {
		address = TronWeb.address.fromPrivateKey(hex(seed));
		sign = async (bytes) => ({
			signature: Trx.signMessageV2(bytes, hex(seed)).toLowerCase(),
		});
	} else if (chain.namespace === 'xrpl') {
		const pair = ripple.deriveKeypair(
			ripple.generateSeed({
				entropy: seed.subarray(0, 16),
				algorithm: chain.alg === -19 ? 'ed25519' : 'ecdsa-secp256k1',
			}),
		);
		address = ripple.deriveAddress(pair.publicKey);
		sign = async (bytes) => ({
			signature: ripple.sign(hex(bytes), pair.privateKey).toLowerCase(),
			publicKey: pair.publicKey.toLowerCase(),
		});
	} else if (chain.namespace === 'bip122') {
		const prefix = chain.profile.split('-')[0],
			version = { bitcoin: [0], litecoin: [48], zcash: [28, 184] }[prefix];
		address = base58check(sha256).encode(
			Uint8Array.from([
				...version,
				...ripemd160(sha256(secp256k1.getPublicKey(seed))),
			]),
		);
		const magic =
			prefix[0].toUpperCase() + prefix.slice(1) + ' Signed Message:\n';
		sign = async (bytes) => ({
			signature: bitcoinMessage
				.sign(
					Buffer.from(bytes),
					seed,
					true,
					String.fromCharCode(Buffer.byteLength(magic)) + magic,
				)
				.toString('base64'),
		});
	} else if (chain.profile === 'cardano-cip8') {
		const raw = Uint8Array.from([0x61, ...blake2b(key, { dkLen: 28 })]);
		address = bech32.encode('addr', bech32.toWords(raw), 128);
		sign = async (bytes) => cardanoSign(bytes, seed, raw);
	} else if (chain.profile === 'monero-spend-v2') {
		monero ??= await import('monero-ts');
		if (!wallets.has(byte))
			wallets.set(
				byte,
				await monero.createWalletFull({
					networkType: 'mainnet',
					proxyToWorker: false,
					privateSpendKey: byte.toString(16).padStart(2, '0') + '00'.repeat(31),
				}),
			);
		const wallet = wallets.get(byte);
		address = await wallet.getPrimaryAddress();
		sign = async (bytes) => ({
			signature: await wallet.signMessage(new TextDecoder().decode(bytes)),
		});
	}
	if (!address || !sign) throw new Error(`No test signer: ${chain.profile}`);
	const selection = accountFor(chain, address);
	return {
		...selection,
		sign,
		proof: async (c) => ({
			...selection,
			requestId: c.requestId,
			...(await sign(new TextEncoder().encode(canonicalMessage(c, selection)))),
		}),
	};
}
export function cardanoSign(bytes, seed, raw, hashed = false) {
	const key = ed25519.getPublicKey(seed),
		protectedBytes = encode(
			new Map([
				[1, -8],
				['address', raw],
			]),
		);
	const payload = hashed ? blake2b(bytes, { dkLen: 28 }) : bytes;
	return {
		signature: hex(
			encode([
				protectedBytes,
				new Map([['hashed', hashed]]),
				payload,
				ed25519.sign(
					encode(['Signature1', protectedBytes, new Uint8Array(), payload]),
					seed,
				),
			]),
		),
		publicKey: hex(
			encode(
				new Map([
					[1, 1],
					[3, -8],
					[-1, 6],
					[-2, key],
				]),
			),
		),
	};
}
export async function moneroViewSignature(bytes, byte = 1) {
	return wallets
		.get(byte)
		.signMessage(
			new TextDecoder().decode(bytes),
			monero.MoneroMessageSignatureType.SIGN_WITH_VIEW_KEY,
		);
}
