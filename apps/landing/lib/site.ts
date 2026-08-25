/** Everything the page links out to, and the few facts it states as numbers. */

export const repo = "https://github.com/pawan67/lift";

export const links = {
  repo,
  /** GitHub redirects this to whatever the newest tag published. */
  release: `${repo}/releases/latest`,
  releases: `${repo}/releases`,
  readme: `${repo}#readme`,
  licence: `${repo}/blob/main/LICENSE`,
  notices: `${repo}/blob/main/NOTICE.md`,
  workflow: `${repo}/blob/main/.github/workflows/android.yml`,
  issues: `${repo}/issues`,

  /*
   * Deep links into the README and the tree, for the two sections that make
   * claims a reader is entitled to check. Each one points at the file that
   * settles the claim rather than at the repository root: `dependencies` is
   * what backs "no analytics SDK", `compose` is the stack the self-hosting
   * section describes, and `updates` is where the one call the app makes to
   * somebody else's server is written up in full.
   */
  selfHosting: `${repo}#self-hosting`,
  compose: `${repo}/blob/main/docker-compose.dokploy.yml`,
  api: `${repo}/tree/main/apps/api`,
  dependencies: `${repo}/blob/main/apps/mobile/package.json`,
  updates: `${repo}#over-the-air-updates`,
} as const;

/*
 * There is deliberately no `version` constant here any more. See
 * `lib/release.ts`: the only version this page is entitled to print is the one
 * GitHub is currently serving, and a string in this file cannot be that.
 */
