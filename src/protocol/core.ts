import { ed448 } from '@noble/curves/ed448.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { ConnectError } from './protocol.js';
/** Core Blockchain XCB ICAN address. Network 1: cb; network 3 (Devin): ab. */
export function coreAddress(publicKey: Uint8Array, reference = '1'): string {
	if (publicKey.length !== 57 || !['1', '3'].includes(reference))
		throw new ConnectError('invalidAccount');
	const prefix = reference === '1' ? 'cb' : 'ab',
		body = Array.from(sha3_256(publicKey).slice(12), (b) =>
			b.toString(16).padStart(2, '0'),
		).join('');
	const decimal = [...`${body}${prefix}00`]
		.map((c) => parseInt(c, 16).toString())
		.join('');
	return `${prefix}${(98n - (BigInt(decimal) % 97n)).toString().padStart(2, '0')}${body}`;
}
export function verifyCoreSignature(
	message: Uint8Array,
	signature: Uint8Array,
	publicKey: Uint8Array,
): boolean {
	try {
		return (
			publicKey.length === 57 &&
			signature.length === 114 &&
			ed448.verify(signature, message, publicKey)
		);
	} catch {
		return false;
	}
}
export function validateCoreAddress(address: string, reference = '1'): boolean {
	if (
		!['1', '3'].includes(reference) ||
		!/^(cb|ab)[0-9]{2}[a-f0-9]{40}$(?![\s\S])/.test(address) ||
		address.slice(0, 2) !== (reference === '1' ? 'cb' : 'ab')
	)
		return false;
	const decimal = [...`${address.slice(4)}${address.slice(0, 4)}`]
		.map((c) => parseInt(c, 16).toString())
		.join('');
	return BigInt(decimal) % 97n === 1n;
}
