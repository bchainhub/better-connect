import { spawnSync } from 'node:child_process';
import { rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prepareSdk } from './prepare-sdk.mjs';
const root = new URL('../', import.meta.url);
function run(args, cwd) {
	const result = spawnSync('npm', args, { cwd, stdio: 'inherit' });
	if (result.status !== 0) throw Error(`npm ${args.join(' ')} failed`);
}
prepareSdk(process.argv[2]);
// Refresh the installed snapshot and any optional local lockfile.
rmSync(new URL('node_modules/connect-protocol', root), {
	recursive: true,
	force: true,
});
const lockPath = new URL('package-lock.json', root);
if (existsSync(lockPath)) {
	const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
	delete lock.packages?.['node_modules/connect-protocol'];
	writeFileSync(lockPath, JSON.stringify(lock, null, '\t') + '\n');
}
rmSync(new URL('node_modules/.package-lock.json', root), { force: true });
run(['install'], root);
