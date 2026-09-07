import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProfileRegistry, xcbAddress } from '../dist/index.js';
import { ed448 } from '@noble/curves/ed448.js';
import { canonicalMessage } from 'connect-protocol';
for (const vector of JSON.parse(
	readFileSync(new URL('./fixtures/conformance.json', import.meta.url)),
)) {
	test(`shared vector: ${vector.name}`, async () => {
		assert.equal(
			canonicalMessage(vector.challenge, vector.proof),
			vector.canonical,
		);
		assert.equal(
			Buffer.from(vector.canonical).toString('hex'),
			vector.canonicalHex,
		);
		assert.deepEqual(
			await new ProfileRegistry()
				.get(vector.proof.profile)
				.verify(vector.challenge, vector.proof),
			vector.proof.account,
		);
	});
}
test('Core go-core reference private key derives reference address', () => {
	const key = Buffer.from(
		'69bb68c3a00a0cd9cbf2cab316476228c758329bbfe0b1759e8634694a9497afea05bcbf24e2aa0627eac4240484bb71de646a9296872a3c0e',
		'hex',
	);
	assert.equal(
		xcbAddress(ed448.getPublicKey(key), '1'),
		'cb82a5fd22b9bee8b8ab877c86e0a2c21765e1d5bfc5',
	);
});
