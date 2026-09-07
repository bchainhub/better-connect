import { writeFileSync } from 'node:fs';
import { signer, requirements, fixtureChallenge } from '../test/helpers.mjs';
import { canonicalMessage, allChains, requirementsFor } from 'connect.js';
import { chainSigner, closeWallets } from '../test/multichain-helpers.mjs';
const challenge = fixtureChallenge();
const vectors = [];
for (const r of requirements) {
	const wallet = signer(r.profile),
		proof = await wallet.proof(challenge),
		canonical = canonicalMessage(challenge, proof);
	vectors.push({
		name: r.profile,
		challenge,
		proof,
		canonical,
		canonicalHex: Buffer.from(canonical).toString('hex'),
		...(wallet.seed ? { testSeed: wallet.seed } : {}),
		valid: true,
	});
}
// Preserve the original four vectors, then cover every additional chain/method.
const expandedChallenge = {
	...challenge,
	requirements: requirementsFor(allChains),
};
try {
	for (const chain of allChains) {
		if (
			vectors.some(
				(v) =>
					v.proof.profile === chain.profile &&
					v.proof.account.reference === chain.reference,
			)
		)
			continue;
		const wallet = await chainSigner(chain),
			proof = await wallet.proof(expandedChallenge),
			canonical = canonicalMessage(expandedChallenge, proof);
		vectors.push({
			name: chain.name,
			challenge: expandedChallenge,
			proof,
			canonical,
			canonicalHex: Buffer.from(canonical).toString('hex'),
			valid: true,
		});
	}
} finally {
	await closeWallets();
}
writeFileSync(
	new URL('../test/fixtures/conformance.json', import.meta.url),
	JSON.stringify(vectors, null, '\t') + '\n',
);
