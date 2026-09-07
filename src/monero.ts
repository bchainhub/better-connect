import {
	defineSigningProfile,
	chains,
	canonicalMessage,
} from 'connect-protocol';
export const moneroProfile = defineSigningProfile({
	id: 'monero-spend-v2',
	namespace: 'monero',
	alg: null,
	validateAccount: (a) =>
		a.reference === chains.monero.reference &&
		/^[48][1-9A-HJ-NP-Za-km-z]{94}$(?![\s\S])/.test(a.address),
	async verify(c, p) {
		if (
			p.publicKey !== undefined ||
			!/^SigV2[1-9A-HJ-NP-Za-km-z]{88}$(?![\s\S])/.test(p.signature)
		)
			return false;
		const imported = await import('monero-ts');
		// CommonJS exposes a default namespace in browser bundles.
		const monero = imported.default ?? imported;
		await monero.MoneroUtils.validateAddress(
			p.account.address,
			monero.MoneroNetworkType.MAINNET,
		);
		const wallet = await monero.createWalletFull({
			networkType: monero.MoneroNetworkType.MAINNET,
			proxyToWorker: false,
			// A disposable verification-only context; never expose/use this key for funds.
			// Explicit height avoids random-wallet initialization querying a daemon.
			privateSpendKey: '01' + '00'.repeat(31),
			restoreHeight: 0,
		});
		try {
			const result = await wallet.verifyMessage(
				canonicalMessage(c, p),
				p.account.address,
				p.signature,
			);
			return (
				result.getIsGood() &&
				!result.getIsOld() &&
				result.getVersion() === 2 &&
				result.getSignatureType() ===
					monero.MoneroMessageSignatureType.SIGN_WITH_SPEND_KEY
			);
		} finally {
			await wallet.close();
		}
	},
});
