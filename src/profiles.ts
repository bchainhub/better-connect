import {
	ProfileRegistry as BrowserProfileRegistry,
	builtInProfiles as browserProfiles,
	type SigningProfile,
} from 'connect-protocol';
import { moneroProfile } from './monero.js';
export * from 'connect-protocol/verification';
export { moneroProfile } from './monero.js';
/** Node WASM loading belongs to the Better Auth backend, never the browser package. */
export const builtInProfiles: readonly SigningProfile[] = Object.freeze(
	browserProfiles.map((profile) =>
		profile.id === moneroProfile.id ? moneroProfile : profile,
	),
);
export class ProfileRegistry extends BrowserProfileRegistry {
	constructor(profiles: readonly SigningProfile[] = builtInProfiles) {
		super(profiles);
	}
}
