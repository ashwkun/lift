// Metro configuration for a pnpm workspace.
//
// Two things differ from a standalone Expo app:
//   1. `@ironlog/shared` is a symlinked workspace package whose *source* we
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

module.exports = config;
