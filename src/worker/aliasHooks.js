// Module resolution hooks for plain Node (registered by src/worker/alias.js): '@/lib/db' becomes
// src/lib/db.js, and extensionless relative imports like './repo' find their .js file, the same
// way Next.js resolves them. Uses module.register() hooks, available from Node 20.6.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withExtension(filePath) {
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  for (const candidate of [`${filePath}.js`, `${filePath}.jsx`, path.join(filePath, 'index.js')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Packages resolve their own imports. Rewriting a CommonJS require('./lib/index') inside
  // node_modules (knex does this) into a file: URL breaks the CommonJS loader.
  if (context.parentURL?.includes('/node_modules/')) return nextResolve(specifier, context);
  let target = null;
  if (specifier.startsWith('@/')) {
    target = withExtension(path.join(srcDir, specifier.slice(2)));
  } else if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    if (!path.extname(specifier)) target = withExtension(path.resolve(parentDir, specifier));
  }
  return nextResolve(target ? pathToFileURL(target).href : specifier, context);
}
