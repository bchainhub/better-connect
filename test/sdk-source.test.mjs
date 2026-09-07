import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sdkSource, assertSdkVersion } from '../scripts/prepare-sdk.mjs';

test('SDK source pin matches the declared archive dependency', () => {
	const source = sdkSource();
	assert.match(source.ref, /^[a-f0-9]{40}$/);
	assert.doesNotThrow(() =>
		assertSdkVersion(
			source,
			{ name: source.name, version: source.version },
			'.connect-sdk',
		),
	);
	for (const manifest of [
		{ name: source.name, version: '0.1.0' },
		{ name: 'connect.js', version: source.version },
	]) {
		assert.throws(
			() => assertSdkVersion(source, manifest, '.connect-sdk'),
			(error) => {
				assert.match(
					error.message,
					/better-connect requires connect-protocol@/,
				);
				assert.ok(error.message.includes(source.ref));
				assert.ok(
					error.message.includes(`${manifest.name}@${manifest.version}`),
				);
				return true;
			},
		);
	}
});
test('version bumps cannot silently leave a stale or floating SDK pin', () => {
	const directory = mkdtempSync(join(tmpdir(), 'connect-source-test-'));
	const root = pathToFileURL(directory + '/');
	try {
		const source = sdkSource();
		writeFileSync(join(directory, 'sdk-source.json'), JSON.stringify(source));
		writeFileSync(
			join(directory, 'package.json'),
			JSON.stringify({
				dependencies: {
					'connect-protocol': 'file:vendor/connect-protocol-9.9.9.tgz',
				},
			}),
		);
		assert.throws(
			() => sdkSource(root),
			/Update sdk-source.json and the dependency together/,
		);
		writeFileSync(
			join(directory, 'sdk-source.json'),
			JSON.stringify({ ...source, ref: 'main' }),
		);
		assert.throws(() => sdkSource(root), /full Git commit SHA/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
