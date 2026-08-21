import { repo } from "./site";

/**
 * What GitHub is currently serving from `/releases/latest`.
 *
 * The version on the download button used to be a constant in this directory,
 * and a constant is wrong here in a way that is worth spelling out, because the
 * obvious fix is also wrong.
 *
 * Reading it from `package.json` looks like the tidy answer: the repository
 * bumps that file when it cuts a version, and the workspace is the single
 * source of truth for everything else. But a release exists when a `v*` tag is
 * pushed and the Android workflow attaches an APK to it, which happens *after*
 * the bump and sometimes days after. Between those two moments `package.json`
 * names a version nobody can download. A landing page that rebuilt in that
 * window would put a button on screen reading "Download v0.4.1" over a link
 * that hands you v0.4.0.
 *
 * So this asks the thing the link actually resolves to. The one fact the page
 * states about the download is read from the same place the download comes
 * from, and the two cannot disagree.
 */
export interface Release {
  /** The tag as GitHub has it, e.g. `v0.4.0`. */
  tag: string;
  /** Size of the attached APK in bytes, or null if the release has no APK. */
  apkBytes: number | null;
}

interface GitHubAsset {
  name: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

const API = repo.replace("https://github.com/", "https://api.github.com/repos/");

/**
 * Every caller gets `null` rather than a guess when this cannot be answered.
 *
 * There are three ways it fails and none of them should take a page down or,
 * worse, print a version that was inferred: the network is unavailable at build
 * time, the unauthenticated rate limit is exhausted, or the repository has no
 * published release yet. In all three the page drops the version from the
 * button and the link still works, because `/releases/latest` is resolved by
 * GitHub rather than by us.
 *
 * Revalidated hourly. Releases are cut by hand, so a page that is at most an
 * hour behind one is not a problem worth spending a request a minute on, and 24
 * calls a day sits well inside the 60-an-hour unauthenticated limit.
 */
export async function latestRelease(): Promise<Release | null> {
  try {
    const response = await fetch(`${API}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "lift-landing",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as GitHubRelease;
    if (!data.tag_name) return null;

    const apk = data.assets?.find((asset) => asset.name.endsWith(".apk"));

    return { tag: data.tag_name, apkBytes: apk?.size ?? null };
  } catch {
    return null;
  }
}

/** Megabytes, one decimal, because that is how a download is quoted. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
