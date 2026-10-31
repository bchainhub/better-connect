import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'better-connect-package-'));
const run = (args, cwd = process.cwd()) =>
	execFileSync('npm', args, {
		cwd,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'inherit'],
	});
function assertStandalone(manifest) {
	for (const section of [
		'dependencies',
		'devDependencies',
		'peerDependencies',
	]) {
		if (manifest[section]?.['connect-protocol'])
			throw Error('Unexpected SDK dependency');
	}
}
try {
	const manifest = JSON.parse(
		await readFile(new URL('../package.json', import.meta.url), 'utf8'),
	);
	assertStandalone(manifest);
	run([
		'publish',
		'--dry-run',
		'--ignore-scripts',
		'--access',
		'public',
		'--json',
	]);
	console.log('npm publish dry-run passed.');
	const packResult = JSON.parse(
		run(['pack', '--json', '--pack-destination', directory]),
	);
	// npm 11 returns an array; npm 12 keys package results by name.
	const packed = Array.isArray(packResult)
		? packResult[0]
		: packResult[manifest.name];
	if (!packed?.filename) throw Error('npm pack returned no archive filename.');
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module' }),
	);
	run(
		[
			'install',
			'--ignore-scripts',
			'--omit=dev',
			'--package-lock=true',
			join(directory, packed.filename),
		],
		directory,
	);
	await writeFile(
		join(directory, 'verify.mjs'),
		`
 import assert from 'node:assert/strict';
 import {readFileSync} from 'node:fs';
 import {createRequire} from 'node:module';
 import {ProfileRegistry,allChains} from 'better-connect';
 const require=createRequire(import.meta.resolve('better-connect'));
 assert.throws(()=>require.resolve('connect-protocol'), {code:'MODULE_NOT_FOUND'});
 const bipRequire=createRequire(require.resolve('bip322-js'));
 assert.ok(bipRequire.resolve('bitcoinjs-lib')); // Fixtures above check the bundled BIP-322 implementation.
 const vectors=JSON.parse(readFileSync(new URL('../test/fixtures/conformance.json', import.meta.resolve('better-connect'))));
 assert.equal(allChains.length,16);
 for(const v of vectors) assert.deepEqual(await new ProfileRegistry().get(v.proof.profile).verify(v.challenge,v.proof),v.proof.account);
 const moneroManifest=JSON.parse(readFileSync(require.resolve('monero-ts/package.json')));
 assert.equal(moneroManifest.dependencies['serialize-javascript'],undefined);
 assert.equal(moneroManifest.dependencies.uuid,undefined);
 console.log('Installed package verified all '+vectors.length+' fixtures without an SDK dependency.');
 `,
	);
	execFileSync(process.execPath, ['verify.mjs'], {
		cwd: directory,
		stdio: 'inherit',
	});
	const audit = JSON.parse(run(['audit', '--omit=dev', '--json'], directory));
	if (audit.metadata.vulnerabilities.total)
		throw new Error('Published runtime dependency audit failed');
	console.log('Published runtime dependency audit: zero advisories.');
} finally {
	await rm(directory, { recursive: true, force: true });
}
