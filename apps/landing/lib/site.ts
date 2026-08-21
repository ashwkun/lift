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
} as const;

/*
 * There is deliberately no `version` constant here any more. See
 * `lib/release.ts`: the only version this page is entitled to print is the one
 * GitHub is currently serving, and a string in this file cannot be that.
 */
