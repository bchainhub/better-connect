import { base64urlnopad } from '@scure/base';
import {
	ConnectError,
	connectUri,
	parseConnectUri,
	proofSchema,
	validateChallenge,
	type Challenge,
	type Proof,
} from './protocol/protocol.js';
const encoder = new TextEncoder();
const MAX = 32768;
const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function keyBytes(key: string) {
	if (!/^[a-f0-9]{64}(?![\s\S])/.test(key))
		throw new ConnectError('invalidHandoff');
	return Uint8Array.from(key.match(/../g)!, (byte) => parseInt(byte, 16));
}
function freeze(c: Challenge) {
	c.requirements.forEach(Object.freeze);
	Object.freeze(c.requirements);
	return Object.freeze(c);
}
/** Per-request service UUID, advertised by the wallet after scanning the handoff. */
export function handoffServiceUuid(requestId: string): string {
	if (!/^[a-f0-9]{64}(?![\s\S])/.test(requestId))
		throw new ConnectError('invalidHandoff');
	const value = requestId.slice(0, 32);
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
/** One shared pairing ticket for QR, deep links, BLE or any text/message channel. Never log this object or link. */
export class ConnectHandoff {
	#challenge: Challenge;
	get challenge(): Challenge {
		return this.#challenge;
	}
	#key: string;
	constructor(
		challenge: Challenge,
		key = hex(crypto.getRandomValues(new Uint8Array(32))),
		private readonly now: () => number = Date.now,
	) {
		keyBytes(key);
		this.#challenge = freeze(validateChallenge(challenge, undefined, now()));
		this.#key = key;
	}
	get uri(): string {
		validateChallenge(this.challenge, undefined, this.now());
		const payload = encoder.encode(
			JSON.stringify({
				type: 'connect:handoff:1',
				challenge: this.challenge,
				key: this.#key,
			}),
		);
		return `${connectUri(this.challenge)}#${base64urlnopad.encode(payload)}`;
	}
	get serviceUuid() {
		return handoffServiceUuid(this.challenge.requestId);
	}
	/** Encryption is transport pairing, not a substitute for verifying the wallet signature. */
	async sealProof(input: Proof): Promise<string> {
		const proof = proofSchema.parse(input);
		if (proof.requestId !== this.challenge.requestId)
			throw new ConnectError('invalidHandoff');
		validateChallenge(this.challenge, undefined, this.now());
		const plaintext = encoder.encode(JSON.stringify(proof));
		if (plaintext.length > 16384) throw new ConnectError('invalidHandoff');
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes(this.#key),
			'AES-GCM',
			false,
			['encrypt'],
		);
		const ciphertext = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: encoder.encode(
					`${this.challenge.origin}/${this.challenge.requestId}`,
				),
			},
			key,
			plaintext,
		);
		return JSON.stringify({
			type: 'connect:response:1',
			requestId: proof.requestId,
			iv: base64urlnopad.encode(iv),
			ciphertext: base64urlnopad.encode(new Uint8Array(ciphertext)),
		});
	}
	async openProof(input: string): Promise<Proof> {
		validateChallenge(this.challenge, undefined, this.now());
		if (input.length > MAX) throw new ConnectError('invalidHandoff');
		try {
			const packet = JSON.parse(input);
			if (
				Object.keys(packet).sort().join(',') !==
					'ciphertext,iv,requestId,type' ||
				packet.type !== 'connect:response:1' ||
				packet.requestId !== this.challenge.requestId
			)
				throw new Error();
			const iv = base64urlnopad.decode(packet.iv);
			if (iv.length !== 12) throw new Error();
			const key = await crypto.subtle.importKey(
				'raw',
				keyBytes(this.#key),
				'AES-GCM',
				false,
				['decrypt'],
			);
			const data = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: new Uint8Array(iv),
					additionalData: encoder.encode(
						`${this.challenge.origin}/${this.challenge.requestId}`,
					),
				},
				key,
				new Uint8Array(base64urlnopad.decode(packet.ciphertext)),
			);
			const proof = proofSchema.parse(
				JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)),
			);
			if (proof.requestId !== this.challenge.requestId) throw new Error();
			validateChallenge(this.challenge, undefined, this.now());
			return proof;
		} catch {
			throw new ConnectError('invalidHandoff');
		}
	}
}
/** expectedOrigin must come from a trusted channel or explicit wallet-user confirmation. */
export function parseConnectHandoff(
	uri: string,
	expectedOrigin: string,
	now: () => number = Date.now,
): ConnectHandoff {
	try {
		if (uri.length > MAX) throw new Error();
		const parts = uri.split('#');
		if (parts.length !== 2 || !parts[1]) throw new Error();
		const target = parseConnectUri(parts[0], ['connect']);
		const data = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				base64urlnopad.decode(parts[1]),
			),
		);
		if (
			Object.keys(data).sort().join(',') !== 'challenge,key,type' ||
			data.type !== 'connect:handoff:1' ||
			target.origin !== expectedOrigin
		)
			throw new Error();
		return new ConnectHandoff(
			validateChallenge(data.challenge, target, now()),
			data.key,
			now,
		);
	} catch {
		throw new ConnectError('invalidHandoff');
	}
}
