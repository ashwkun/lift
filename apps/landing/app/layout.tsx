import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

/*
 * The page is now set in the app's own typeface rather than in a stand-in for
 * it.
 *
 * It used to run Archivo, chosen to land near Spotify Mix without shipping a
 * licence this project did not have. The app has since moved to JetBrains Sans
 * and bundles the three cuts itself, so the stand-in has nothing left to stand
 * in for: these are the same three files, and a screenshot on this page is now
 * set in the same face as the paragraph beside it.
 *
 * Two differences from `apps/mobile/assets/fonts`, both deliberate.
 *
 * They are copies rather than a relative path across the workspace, because
 * `apps/landing/Dockerfile` only copies `apps/landing` into the build stage: a
 * path into the mobile app resolves on a laptop and fails in the image, which
 * is the worse of the two places to find out.
 *
 * And they are woff2 rather than the TTFs the app loads, which is a container
 * change and not a subsetting one: same glyphs, 35 KB a cut against 88. React
 * Native has to have TTF and cannot use these; a browser has had woff2 for a
 * decade and should not be handed 265 KB of uncompressed font to render a
 * headline. Regenerate with `woff2_compress` if the app's files ever change.
 *
 * **The licence is not squarely established.** `apps/mobile/src/theme/tokens.ts`
 * records the same caveat and it is worth repeating here, because a public web
 * page serves the file to anyone who loads it rather than to whoever installed
 * an APK: the TTFs carry no licence record in their `name` table, and the
 * family is JetBrains' brand face rather than their OFL-licensed Mono. Settle
 * it before this page is anything but sideloading's front door.
 */
const jetbrainsSans = localFont({
  variable: "--font-jetbrains-sans",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  /*
   * Three files, four weights, and the duplicate is the point. The app folds
   * its `medium` role up into SemiBold rather than down into Regular, because
   * folding down would leave a label indistinguishable from body copy. CSS
   * font matching resolves a request for 500 *downwards* to 400, which is
   * exactly the fold this project rejected, so the SemiBold is registered at
   * both 500 and 600 and every `font-medium` on the page lands where the app
   * puts it. One file, declared twice: the browser fetches it once.
   */
  src: [
    { path: "./fonts/JetBrainsSans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsSans-SemiBold.woff2", weight: "500", style: "normal" },
    { path: "./fonts/JetBrainsSans-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/JetBrainsSans-Bold.woff2", weight: "700", style: "normal" },
  ],
});

/*
 * The mono, for labels and for anything printed as a figure.
 *
 * JetBrains Mono rather than the Azeret it replaces: it is the sans above's
 * own sibling, drawn to the same skeleton, and unlike the sans it is under the
 * OFL with nothing to settle. The app has no mono at all; it sets its figures
 * in JetBrains Sans with `tnum` on. This page cannot do that in every place it
 * wants a figure, so the family's own monospace is the closest thing to the
 * app's intent that a stylesheet can name.
 */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/*
 * Where this page is served from, which is not where its source lives.
 *
 * `metadataBase` is what Next resolves `opengraph-image.png` against, so
 * pointing it at the repository would hand Slack and Twitter a github.com URL
 * that answers 404. It has to be the site's own origin, it has to be absolute,
 * and nothing in the build can work it out on its own.
 *
 * The fallback is localhost rather than a guessed domain: a card that fails to
 * load while you are developing is obvious, and a card that loads the wrong
 * site's image is not. Set `NEXT_PUBLIC_SITE_URL` when deploying. It is read at
 * build time, so changing it means rebuilding rather than restarting.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Lift: a workout tracker that lives on your phone",
  description:
    "Every workout, set, routine and record in a real database on the phone. " +
    "Works with no account and no network. No analytics, no trackers and no " +
    "ads in the build. Sync is optional, and the server behind it is in the " +
    "repository for you to run yourself.",
  applicationName: "Lift",
  keywords: [
    "workout tracker",
    "local-first",
    "offline workout tracker",
    "open source",
    "Android",
    "gym log",
    "self-hosted",
    "self-hosted sync",
    "private workout tracker",
    "no tracking",
    "AGPL",
  ],
  openGraph: {
    title: "Lift: a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account and no trackers. Sync is " +
      "optional and self-hostable. AGPL-3.0.",
    type: "website",
    siteName: "Lift",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lift: a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account and no trackers. Sync is " +
      "optional and self-hostable. AGPL-3.0.",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jetbrainsSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink text-fg">{children}</body>
    </html>
  );
}
