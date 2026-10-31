import { rmSync } from 'node:fs';
// Do not publish stale declarations or files from a previous source layout.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
