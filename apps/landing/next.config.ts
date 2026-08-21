import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /*
   * Ship a server, not a static export.
   *
   * The download button reads the current release from the GitHub API with an
   * hourly revalidation (see `lib/release.ts`), and revalidation is the one
   * thing `next export` cannot do: an exported page is frozen at build time, so
   * the version on the button would only ever change when the site was rebuilt.
   * That is the bug this page just stopped having.
   */
  output: "standalone",

  /*
   * Trace from the workspace root rather than from this directory.
   *
   * In a pnpm workspace the real dependencies live in a store above this
   * package and are reached through symlinks. Left to guess, the tracer walks
   * up looking for a lockfile and warns that it found several plausible roots;
   * pinned here, the standalone output contains the files the server actually
   * opens. Getting this wrong does not fail the build, it fails the container
   * at startup with a module that is not there.
   */
  outputFileTracingRoot: path.join(here, "../.."),

  images: {
    /*
     * The screenshots are the product, and they are dense UI shown small. 88
     * rather than the default 75 because at 75 the lime-on-true-black type in
     * them picks up visible ringing, which is the one artefact this palette
     * makes obvious. Next 16 requires every quality the app asks for to be
     * listed here rather than accepting it per call site.
     */
    qualities: [75, 88],
  },
};

export default nextConfig;
