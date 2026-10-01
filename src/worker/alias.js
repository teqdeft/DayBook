// Lets plain Node (the worker and scripts) resolve the same imports Next.js does:
// '@/lib/db' -> src/lib/db.js, and extensionless relative imports like './repo'.
// Used as: node --import ./src/worker/alias.js src/worker/index.js
// module.register() works from Node 20.6, so this runs on hosts that only offer Node 20.
import { register } from 'node:module';

register('./aliasHooks.js', import.meta.url);
