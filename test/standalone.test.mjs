import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
test('authentication package has no SDK dependency, source pin or vendor archive', () => {
	const manifest = JSON.parse(readFileSync(new URL('package.json', root)));
	for (const section of ['dependencies', 'devDependencies', 'peerDependencies'])
		assert.equal(manifest[section]?.['connect-protocol'], undefined);
	assert.ok(!manifest.bundleDependencies.includes('connect-protocol'));
	assert.ok(!manifest.files.includes('vendor'));
	assert.ok(!manifest.scripts['prepare:sdk']);
});
test('compiled authentication modules resolve no sibling SDK or checkout', () => {
	function walk(path) {
		return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
		);
	}
	for (const path of walk(fileURLToPath(new URL('dist/', root))).filter((p) =>
		/\.(?:js|ts)$/.test(p),
	)) {
		const code = readFileSync(path, 'utf8');
		assert.doesNotMatch(
			code,
			/(?:from\s*|import\s*\(|require\s*\()\s*['"](?:connect-protocol|\.\.\/\.\.\/connect\.js)/,
			path,
		);
	}
});
