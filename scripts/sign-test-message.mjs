// Test-only host-wallet bridge. Never load deterministic test keys in an app.
import { allChains } from 'connect.js';
import { chainSigner, closeWallets } from '../test/multichain-helpers.mjs';
const [profile, reference, messageHex] = process.argv.slice(2);
try {
	const chain = allChains.find(
		(c) => c.profile === profile && c.reference === reference,
	);
	if (!chain) throw new Error('Unknown test chain');
	const wallet = await chainSigner(chain);
	console.log(
		JSON.stringify(await wallet.sign(Buffer.from(messageHex, 'hex'))),
	);
} finally {
	await closeWallets();
}
