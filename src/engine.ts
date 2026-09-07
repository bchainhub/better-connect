import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	ConnectError,
	compatible,
	connectUri,
	proofSchema,
	requirementSchema,
	requirementsFor,
	validateChallenge,
	validateOrigin,
	type Account,
	type Challenge,
	type Requirement,
	type ChainDefinition,
} from 'connect-protocol';
import { ProfileRegistry } from './profiles.js';
export type Status = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'DENIED' | 'EXPIRED';
export interface RequestRecord {
	id: string;
	challenge: Challenge;
	secretHash: string;
	status: Status;
	account: Account | null;
}
/** Implementations MUST perform compareAndSet as a single conditional database operation. */
export interface RequestStore {
	create(record: RequestRecord): Promise<void>;
	get(id: string): Promise<RequestRecord | null>;
	compareAndSet(
		id: string,
		expected: Status,
		status: Status,
		now: number,
		account?: Account,
	): Promise<boolean>;
}
/** Bounded process-local store for tests/development, never for multiple server instances. */
export class MemoryRequestStore implements RequestStore {
	private readonly records = new Map<string, RequestRecord>();
	async create(r: RequestRecord) {
		for (const [id, item] of this.records)
			if (Date.parse(item.challenge.expiresAt) <= Date.now())
				this.records.delete(id);
		if (this.records.size >= 10000 || this.records.has(r.id))
			throw new ConnectError('capacityExceeded');
		this.records.set(r.id, structuredClone(r));
	}
	async get(id: string) {
		const r = this.records.get(id);
		return r ? structuredClone(r) : null;
	}
	async compareAndSet(
		id: string,
		expected: Status,
		status: Status,
		now: number,
		account?: Account,
	) {
		const r = this.records.get(id);
		if (
			!r ||
			r.status !== expected ||
			(status !== 'EXPIRED' && Date.parse(r.challenge.expiresAt) <= now)
		)
			return false;
		r.status = status;
		if (account) r.account = structuredClone(account);
		return true;
	}
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface EngineOptions {
	origin: string;
	requirements?: readonly Requirement[];
	chains?: readonly ChainDefinition[];
	store: RequestStore;
	registry?: ProfileRegistry;
	ttlMs?: number;
	now?: () => number;
}
export class ConnectEngine {
	private readonly registry: ProfileRegistry;
	private readonly now: () => number;
	private readonly ttl: number;
	private readonly requirements: Requirement[];
	constructor(private readonly options: EngineOptions) {
		validateOrigin(options.origin);
		this.registry = options.registry ?? new ProfileRegistry();
		this.now = options.now ?? Date.now;
		this.ttl = options.ttlMs ?? 120000;
		if (options.requirements && options.chains)
			throw new ConnectError('invalidConfiguration');
		const requirements =
			options.requirements ?? requirementsFor(options.chains ?? []);
		if (
			!Number.isInteger(this.ttl) ||
			this.ttl < 1000 ||
			this.ttl > 300000 ||
			!requirements.length ||
			requirements.length > 32
		)
			throw new ConnectError('invalidConfiguration');
		this.requirements = requirements.map((r) => {
			const x = requirementSchema.parse(r),
				p = this.registry.get(x.profile);
			if (p.namespace !== x.namespace || p.alg !== x.alg)
				throw new ConnectError('invalidConfiguration');
			return x;
		});
	}
	async create() {
		const requestId = randomBytes(32).toString('hex'),
			redeemSecret = randomBytes(32).toString('hex'),
			now = this.now();
		const challenge: Challenge = {
			version: 1,
			requestId,
			nonce: randomBytes(32).toString('hex'),
			origin: this.options.origin,
			domain: this.options.origin.slice(8),
			issuedAt: new Date(now).toISOString(),
			expiresAt: new Date(now + this.ttl).toISOString(),
			requirements: this.requirements,
		};
		await this.options.store.create({
			id: requestId,
			challenge,
			secretHash: hash(redeemSecret),
			status: 'PENDING',
			account: null,
		});
		return {
			requestId,
			redeemSecret,
			connectUri: connectUri(challenge),
			challenge: structuredClone(challenge),
			expiresAt: challenge.expiresAt,
		};
	}
	private async load(id: string) {
		if (!/^[a-f0-9]{64}(?![\s\S])/.test(id))
			throw new ConnectError('invalidRequest');
		const r = await this.options.store.get(id);
		if (!r) throw new ConnectError('unknownRequest');
		if (
			Date.parse(r.challenge.expiresAt) <= this.now() &&
			['PENDING', 'APPROVED'].includes(r.status)
		) {
			await this.options.store.compareAndSet(
				id,
				r.status,
				'EXPIRED',
				this.now(),
			);
			r.status = 'EXPIRED';
		}
		return r;
	}
	async challenge(id: string) {
		const r = await this.load(id);
		if (r.status !== 'PENDING')
			throw new ConnectError(
				r.status === 'EXPIRED' ? 'expiredRequest' : 'invalidState',
			);
		return validateChallenge(
			r.challenge,
			{ origin: this.options.origin, requestId: id },
			this.now(),
		);
	}
	async status(id: string) {
		const r = await this.load(id);
		return { requestId: id, status: r.status };
	}
	async approve(input: unknown) {
		const parsed = proofSchema.safeParse(input);
		if (!parsed.success) throw new ConnectError('malformedProof');
		const proof = parsed.data;
		const c = await this.challenge(proof.requestId),
			p = this.registry.get(proof.profile);
		if (
			!compatible(c, proof) ||
			p.alg !== proof.alg ||
			p.namespace !== proof.account.namespace ||
			!p.validateAccount(proof.account)
		)
			throw new ConnectError('unsupportedAccount');
		let account: Account;
		try {
			account = await p.verify(c, proof);
		} catch {
			throw new ConnectError('invalidProof');
		}
		if (
			account.namespace !== proof.account.namespace ||
			account.reference !== proof.account.reference ||
			account.address !== proof.account.address
		)
			throw new ConnectError('invalidProof');
		if (
			!(await this.options.store.compareAndSet(
				c.requestId,
				'PENDING',
				'APPROVED',
				this.now(),
				account,
			))
		)
			throw new ConnectError('invalidState');
		return { requestId: c.requestId, status: 'APPROVED' as const };
	}
	private checkSecret(r: RequestRecord, secret: string) {
		if (
			!/^[a-f0-9]{64}(?![\s\S])/.test(secret) ||
			!timingSafeEqual(
				Buffer.from(hash(secret), 'hex'),
				Buffer.from(r.secretHash, 'hex'),
			)
		)
			throw new ConnectError('invalidCredential');
	}
	async deny(id: string, secret: string) {
		const r = await this.load(id);
		this.checkSecret(r, secret);
		if (
			!(await this.options.store.compareAndSet(
				id,
				'PENDING',
				'DENIED',
				this.now(),
			))
		)
			throw new ConnectError('invalidState');
		return { requestId: id, status: 'DENIED' as const };
	}
	async redeem(id: string, secret: string): Promise<Account> {
		const r = await this.load(id);
		this.checkSecret(r, secret);
		if (
			r.status !== 'APPROVED' ||
			!r.account ||
			!(await this.options.store.compareAndSet(
				id,
				'APPROVED',
				'CONSUMED',
				this.now(),
			))
		)
			throw new ConnectError('invalidState');
		return r.account;
	}
}
