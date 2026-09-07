import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
try {
	const [packed] = JSON.parse(
		run(['pack', '--json', '--pack-destination', directory]),
	);
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
 const vectors=JSON.parse(readFileSync(new URL('../test/fixtures/conformance.json', import.meta.resolve('better-connect'))));
 assert.equal(allChains.length,16);
 for(const v of vectors) assert.deepEqual(await new ProfileRegistry().get(v.proof.profile).verify(v.challenge,v.proof),v.proof.account);
 const moneroRequire=createRequire(require.resolve('monero-ts'));
 assert.equal(JSON.parse(readFileSync(moneroRequire.resolve('serialize-javascript/package.json'))).version.split('.')[0],'7');
 assert.equal(JSON.parse(readFileSync(moneroRequire.resolve('uuid/package.json'))).version.split('.')[0],'11');
 console.log('Installed package verified all '+vectors.length+' fixtures and patched Monero dependencies.');
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
