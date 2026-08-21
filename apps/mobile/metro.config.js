// Metro configuration for a pnpm workspace.
//
// Two things differ from a standalone Expo app:
//   1. `@lift/shared` is a symlinked workspace package whose *source* we
//      consume directly, so Metro has to watch the repo root to pick up edits.
//   2. Dependencies are hoisted to the root `node_modules`, while the workspace
//      link lives in the app's own — both paths must be resolvable.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Drizzle emits migrations as .sql files that are imported as strings.
config.resolver.sourceExts.push('sql');

/*
 * The web build's database.
 *
 * On a phone `expo-sqlite` is a native module; in a browser there is no such
 * thing, so it ships wa-sqlite — SQLite compiled to WebAssembly — and runs it in
 * a worker. `web/worker.ts` imports `wa-sqlite.wasm` directly, and Metro treats
 * an unknown extension as a *module* to parse rather than as a file to copy, so
 * without this the web bundle does not merely lose SQLite: it fails to resolve
 * and no bundle is produced at all. Native never reaches this import.
 */
config.resolver.assetExts.push('wasm');

/*
 * The two headers wa-sqlite's storage needs.
 *
 * It persists through OPFS, and the synchronous access handles that requires are
 * only exposed to a cross-origin-isolated document — which a browser grants only
 * when both of these are present. Without them the worker still loads and the
 * database still answers queries, but it does so in memory, so every workout
 * logged in that tab is gone on reload. A local-first app that silently forgets
 * is worse than one that plainly does not run.
 *
 * `credentialless` rather than `require-corp` for the embedder policy: the
 * stricter value would also demand CORP headers on every cross-origin subresource,
 * and this app loads its exercise artwork from wherever the catalog points.
 *
 * This covers `expo start --web` and `expo serve`. A static export put behind
 * some other web server has to send the same two headers from there — see the
 * README.
 */
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
