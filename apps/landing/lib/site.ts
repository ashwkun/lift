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

export const version = "0.4.0";
