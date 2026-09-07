import type { DBAdapter } from 'better-auth';
import type { Account, Challenge } from 'connect.js';
import type { RequestRecord, RequestStore, Status } from './engine.js';
interface Row {
	requestId: string;
	challenge: string;
	secretHash: string;
	status: Status;
	account: string | null;
}
export class AdapterRequestStore implements RequestStore {
	constructor(private readonly adapter: DBAdapter) {}
	async create(r: RequestRecord) {
		await this.adapter.create({
			model: 'connectRequest',
			data: {
				requestId: r.id,
				challenge: JSON.stringify(r.challenge),
				secretHash: r.secretHash,
				status: r.status,
				account: null,
				expiresAt: new Date(r.challenge.expiresAt),
			},
		});
	}
	async get(id: string): Promise<RequestRecord | null> {
		const r = await this.adapter.findOne<Row>({
			model: 'connectRequest',
			where: [{ field: 'requestId', value: id }],
		});
		return r
			? {
					id: r.requestId,
					challenge: JSON.parse(r.challenge) as Challenge,
					secretHash: r.secretHash,
					status: r.status,
					account: r.account ? (JSON.parse(r.account) as Account) : null,
				}
			: null;
	}
	async compareAndSet(
		id: string,
		expected: Status,
		status: Status,
		now: number,
		account?: Account,
	) {
		const count = await this.adapter.updateMany({
			model: 'connectRequest',
			where: [
				{ field: 'requestId', value: id },
				{ field: 'status', value: expected },
				...(status === 'EXPIRED'
					? []
					: [
							{
								field: 'expiresAt',
								value: new Date(now),
								operator: 'gt' as const,
							},
						]),
			],
			update: {
				status,
				...(account ? { account: JSON.stringify(account) } : {}),
			},
		});
		return count === 1;
	}
}
export const connectSchema = {
	connectRequest: {
		fields: {
			requestId: { type: 'string', required: true, unique: true },
			challenge: { type: 'string', required: true },
			secretHash: { type: 'string', required: true },
			status: { type: 'string', required: true },
			account: { type: 'string', required: false },
			expiresAt: { type: 'date', required: true, index: true },
		},
	},
	connectWallet: {
		fields: {
			identity: { type: 'string', required: true, unique: true },
			userId: {
				type: 'string',
				required: true,
				references: { model: 'user', field: 'id', onDelete: 'cascade' },
			},
			createdAt: { type: 'date', required: true },
		},
	},
} as const;
