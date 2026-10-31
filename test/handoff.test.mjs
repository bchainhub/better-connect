import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConnectHandoff, parseConnectHandoff } from '../dist/protocol/index.js';
const vectors = JSON.parse(
	readFileSync(new URL('./fixtures/conformance.json', import.meta.url)),
);
const now = () => Date.parse('2026-09-07T10:00:00.000Z');
for (const v of vectors)
	test('encrypted handoff ' + v.name, async () => {
		const ticket = new ConnectHandoff(v.challenge, '01'.repeat(32), now);
		const wallet = parseConnectHandoff(ticket.uri, v.challenge.origin, now);
		const response = await wallet.sealProof(v.proof);
		assert.deepEqual(await ticket.openProof(response), v.proof);
		assert.notEqual(response, await wallet.sealProof(v.proof));
		await assert.rejects(
			new ConnectHandoff(v.challenge, '02'.repeat(32), now).openProof(response),
		);
		const packet = JSON.parse(response);
		packet.ciphertext =
			(packet.ciphertext[0] === 'A' ? 'B' : 'A') + packet.ciphertext.slice(1);
		await assert.rejects(ticket.openProof(JSON.stringify(packet)));
		assert.throws(() =>
			parseConnectHandoff(ticket.uri, 'https://evil.example', now),
		);
		assert.throws(() =>
			parseConnectHandoff(ticket.uri + '#extra', v.challenge.origin, now),
		);
		assert.throws(() =>
			parseConnectHandoff(ticket.uri, v.challenge.origin, () => now() + 300000),
		);
	});
test(
	'Dart response packets decrypt to identical proofs',
	{ skip: !process.env.CONNECT_DART_RESPONSES },
	async () => {
		const path = process.env.CONNECT_DART_RESPONSES;
		if (!path) return;
		for (const [i, response] of JSON.parse(readFileSync(path)).entries()) {
			assert.deepEqual(
				await new ConnectHandoff(
					vectors[i].challenge,
					'01'.repeat(32),
					now,
				).openProof(response),
				vectors[i].proof,
			);
		}
	},
);
