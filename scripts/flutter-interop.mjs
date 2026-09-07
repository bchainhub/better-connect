import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { betterConnect } from '../dist/index.js';
import { requirements as originalRequirements } from '../test/helpers.mjs';
import { allChains, requirementsFor } from 'connect-protocol';
const requirements = [...requirementsFor(allChains), originalRequirements[1]];
const database = new Database(':memory:');
const options = {
	database,
	rateLimit: { enabled: false },
	baseURL: 'https://example.com/api/auth',
	secret: 'test-only-secret-at-least-32-characters-long',
	plugins: [betterConnect({ origin: 'https://example.com', requirements })],
};
await (await getMigrations(options)).runMigrations();
const auth = betterAuth(options);
let sessions = 0;
const server = createServer(async (req, res) => {
	try {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = Buffer.concat(chunks);
		const response = await auth.handler(
			new Request(`https://example.com/api/auth/wallet-connect${req.url}`, {
				method: req.method,
				headers: {
					'content-type': 'application/json',
					origin: 'https://example.com',
				},
				...(body.length ? { body } : {}),
			}),
		);
		if (req.url === '/redeem' && response.ok) {
			const cookie = response.headers.get('set-cookie');
			if (!cookie?.includes('HttpOnly') || !cookie.includes('Secure'))
				throw Error('Missing secure session cookie');
			const check = await auth.handler(
				new Request('https://example.com/api/auth/get-session', {
					headers: { cookie: cookie.split(';')[0] },
				}),
			);
			if (!(await check.json())?.user)
				throw Error('Session did not authenticate');
			sessions++;
		}
		res.writeHead(response.status, { 'content-type': 'application/json' });
		res.end(await response.text());
	} catch (e) {
		console.error(e);
		res.writeHead(500);
		res.end('{}');
	}
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const child = spawn('flutter', ['test', 'test/server_interop_test.dart'], {
	cwd: new URL('../../flutter_connect/', import.meta.url),
	env: {
		...process.env,
		CONNECT_TEST_URL: `http://127.0.0.1:${server.address().port}`,
	},
	stdio: 'inherit',
});
try {
	const code = await new Promise((resolve, reject) => {
		child.on('exit', resolve);
		child.on('error', reject);
	});
	if (code !== 0 || sessions !== 17)
		throw Error(
			`Flutter exit=${code}; authenticated desktop sessions=${sessions}`,
		);
	console.log(
		'Dart approved and redeemed 17 real Better Auth sessions across all chains and proof schemes.',
	);
} finally {
	server.close();
	database.close();
}

// The wallet also returns encrypted proofs without making any HTTP call.
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const directory = await mkdtemp(join(tmpdir(), 'connect-offline-'));
const env = {
	...process.env,
	CONNECT_DART_RESPONSES: join(directory, 'responses.json'),
};
async function runOffline(command, args, cwd) {
	const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
	const code = await new Promise((resolve, reject) => {
		child.on('exit', resolve);
		child.on('error', reject);
	});
	if (code !== 0) throw Error('Offline interoperability failed: ' + command);
}
try {
	await runOffline(
		'flutter',
		['test', 'test/handoff_test.dart'],
		new URL('../../flutter_connect/', import.meta.url),
	);
	await runOffline(
		process.execPath,
		['--test', 'test/handoff.test.mjs'],
		new URL('../../connect.js/', import.meta.url),
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
