import type { BetterAuthPlugin, User, AuthContext } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
	ConnectError,
	idSchema,
	proofSchema,
	type Requirement,
	type ChainDefinition,
} from 'connect.js';
import { ConnectEngine, type RequestStore } from './engine.js';
import { AdapterRequestStore, connectSchema } from './store.js';
import { ProfileRegistry } from './profiles.js';
export * from './engine.js';
export * from './profiles.js';
export * from './multichain.js';
export {
	chains,
	allChains,
	defineChain,
	evmChain,
	requirementsFor,
} from 'connect.js';
export * from './store.js';
export interface BetterConnectOptions {
	origin: string;
	requirements?: readonly Requirement[];
	chains?: readonly ChainDefinition[];
	ttlMs?: number;
	registry?: ProfileRegistry;
	store?: RequestStore;
}
const requestQuery = z.object({ requestId: idSchema }).strict();
const credential = z
	.object({ requestId: idSchema, redeemSecret: idSchema })
	.strict();
async function safe<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ConnectError)
			throw new APIError('BAD_REQUEST', { code: e.code, message: e.code });
		throw e;
	}
}
function requireInitiator(headers: Headers | undefined, origin: string) {
	if (headers?.get('origin') !== origin)
		throw new APIError('FORBIDDEN', {
			code: 'domainMismatch',
			message: 'domainMismatch',
		});
}
async function resolveUser(
	context: AuthContext,
	identity: string,
): Promise<User> {
	const find = () =>
		context.adapter.findOne<{ userId: string }>({
			model: 'connectWallet',
			where: [{ field: 'identity', value: identity }],
		});
	let wallet = await find();
	if (!wallet) {
		// Random placeholder prevents collisions with an unrelated email/password account.
		const user = await context.internalAdapter.createUser(
			{
				name: 'Wallet user',
				email: `${randomBytes(24).toString('hex')}@connect.invalid`,
				emailVerified: false,
			},
			{ method: 'connect' },
		);
		try {
			await context.adapter.create({
				model: 'connectWallet',
				data: { identity, userId: user.id, createdAt: new Date() },
			});
			return user;
		} catch (e) {
			await context.internalAdapter.deleteUser(user.id);
			wallet = await find();
			if (!wallet) throw e;
		}
	}
	const user = await context.adapter.findOne<User>({
		model: 'user',
		where: [{ field: 'id', value: wallet.userId }],
	});
	if (!user)
		throw new APIError('INTERNAL_SERVER_ERROR', {
			message: 'Missing wallet user',
		});
	return user;
}
export function betterConnect(options: BetterConnectOptions) {
	// Validate static policy eagerly without creating any authentication state.
	new ConnectEngine({
		...options,
		store: options.store ?? {
			create: async () => {},
			get: async () => null,
			compareAndSet: async () => false,
		},
	});
	const engine = (context: AuthContext) => {
		if (context.baseURL !== `${options.origin}/api/auth`)
			throw new ConnectError('invalidBaseURL');
		return new ConnectEngine({
			...options,
			store: options.store ?? new AdapterRequestStore(context.adapter),
		});
	};
	return {
		id: 'better-connect',
		schema: connectSchema,
		rateLimit: [
			{
				pathMatcher: (path: string) => path.startsWith('/wallet-connect/'),
				window: 60,
				max: 60,
			},
		],
		endpoints: {
			walletConnectCreate: createAuthEndpoint(
				'/wallet-connect/create',
				{ method: 'POST', body: z.object({}).strict() },
				async (ctx) => {
					requireInitiator(ctx.headers, options.origin);
					ctx.setHeader('Cache-Control', 'no-store');
					return ctx.json(await safe(() => engine(ctx.context).create()));
				},
			),
			walletConnectChallenge: createAuthEndpoint(
				'/wallet-connect/challenge',
				{ method: 'GET', query: requestQuery },
				async (ctx) => {
					ctx.setHeader('Cache-Control', 'no-store');
					return ctx.json(
						await safe(() =>
							engine(ctx.context).challenge(ctx.query.requestId),
						),
					);
				},
			),
			walletConnectStatus: createAuthEndpoint(
				'/wallet-connect/status',
				{ method: 'GET', query: requestQuery },
				async (ctx) => {
					ctx.setHeader('Cache-Control', 'no-store');
					return ctx.json(
						await safe(() => engine(ctx.context).status(ctx.query.requestId)),
					);
				},
			),
			walletConnectApprove: createAuthEndpoint(
				'/wallet-connect/approve',
				{ method: 'POST', body: proofSchema },
				async (ctx) => {
					ctx.setHeader('Cache-Control', 'no-store');
					return ctx.json(
						await safe(() => engine(ctx.context).approve(ctx.body)),
					);
				},
			),
			walletConnectDeny: createAuthEndpoint(
				'/wallet-connect/deny',
				{ method: 'POST', body: credential },
				async (ctx) => {
					requireInitiator(ctx.headers, options.origin);
					return ctx.json(
						await safe(() =>
							engine(ctx.context).deny(
								ctx.body.requestId,
								ctx.body.redeemSecret,
							),
						),
					);
				},
			),
			walletConnectRedeem: createAuthEndpoint(
				'/wallet-connect/redeem',
				{ method: 'POST', body: credential },
				async (ctx) => {
					requireInitiator(ctx.headers, options.origin);
					ctx.setHeader('Cache-Control', 'no-store');
					const account = await safe(() =>
						engine(ctx.context).redeem(
							ctx.body.requestId,
							ctx.body.redeemSecret,
						),
					);
					const identity = createHash('sha256')
						.update(
							`${account.namespace}:${account.reference}:${account.address}`,
						)
						.digest('hex');
					const user = await resolveUser(ctx.context, identity);
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session)
						throw new APIError('INTERNAL_SERVER_ERROR', {
							message: 'Session creation failed',
						});
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ success: true, user: { id: user.id } });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
