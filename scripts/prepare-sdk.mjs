import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function prepareSdk(
	sdkPath = fileURLToPath(new URL('../../connect.js/', import.meta.url)),
) {
	const root = new URL('../', import.meta.url);
	const sdk = resolve(sdkPath);
	const manifest = JSON.parse(
		readFileSync(new URL('package.json', root), 'utf8'),
	);
	const sdkManifest = JSON.parse(
		readFileSync(resolve(sdk, 'package.json'), 'utf8'),
	);
	const archive = `${sdkManifest.name}-${sdkManifest.version}.tgz`;
	if (manifest.dependencies['connect.js'] !== `file:vendor/${archive}`) {
		throw Error('The SDK checkout version must match the plugin dependency.');
	}
	const fixture = 'test/fixtures/conformance.json';
	if (
		!readFileSync(new URL(fixture, root)).equals(
			readFileSync(resolve(sdk, fixture)),
		)
	) {
		throw Error(
			'SDK and plugin reference fixtures differ; review protocol compatibility.',
		);
	}
	function run(args) {
		const result = spawnSync('npm', args, { cwd: sdk, stdio: 'inherit' });
		if (result.status !== 0) throw Error(`SDK npm ${args.join(' ')} failed`);
	}
	run(['install', '--package-lock=false']);
	run(['run', 'build']);
	const vendor = new URL('vendor/', root);
	mkdirSync(vendor, { recursive: true });
	run(['pack', '--pack-destination', fileURLToPath(vendor)]);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	prepareSdk(process.argv[2]);
}
