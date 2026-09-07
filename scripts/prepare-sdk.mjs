import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// CI uses an immutable source revision, independent of SDK default-branch updates.
export function sdkSource(root = new URL('../', import.meta.url)) {
	const source = JSON.parse(
		readFileSync(new URL('sdk-source.json', root), 'utf8'),
	);
	const manifest = JSON.parse(
		readFileSync(new URL('package.json', root), 'utf8'),
	);
	if (
		source.repository !== 'bchainhub/connect.js' ||
		source.name !== 'connect-protocol' ||
		!/^[a-f0-9]{40}$/.test(source.ref)
	) {
		throw Error(
			'sdk-source.json must identify connect-protocol with a full Git commit SHA.',
		);
	}
	const expected = `file:vendor/${source.name}-${source.version}.tgz`;
	if (manifest.dependencies?.[source.name] !== expected) {
		throw Error(
			`SDK pin ${source.name}@${source.version} requires ${expected}, but package.json declares ${manifest.dependencies?.[source.name]}. Update sdk-source.json and the dependency together.`,
		);
	}
	return source;
}

export function assertSdkVersion(source, sdkManifest, sdkPath) {
	if (
		sdkManifest.name !== source.name ||
		sdkManifest.version !== source.version
	) {
		throw Error(
			`SDK checkout at ${sdkPath} is ${sdkManifest.name}@${sdkManifest.version}; better-connect requires ${source.name}@${source.version}. Check out ${source.repository} at ${source.ref} (sdk-source.json), or update the SDK pin and dependency together.`,
		);
	}
}

export function prepareSdk(
	sdkPath = fileURLToPath(new URL('../../connect.js/', import.meta.url)),
) {
	const root = new URL('../', import.meta.url);
	const sdk = resolve(sdkPath);
	const source = sdkSource(root);
	const sdkManifest = JSON.parse(
		readFileSync(resolve(sdk, 'package.json'), 'utf8'),
	);
	assertSdkVersion(source, sdkManifest, sdk);
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
	if (process.argv[2] === '--ref') console.log(sdkSource().ref);
	else prepareSdk(process.argv[2]);
}
