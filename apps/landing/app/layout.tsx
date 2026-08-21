import type { Metadata, Viewport } from "next";
import { Archivo, Azeret_Mono } from "next/font/google";

import "./globals.css";

/*
 * The app's own face is Spotify Mix, bundled into the APK and not something
 * this project has a licence to redistribute over the web. So the page is set
 * in two faces chosen to land in the same place rather than to imitate: a wide,
 * heavy grotesque for anything that carries weight, and an industrial mono for
 * the things the app itself sets in tabular figures.
 *
 * Archivo carries a real width axis, which is what the match hinges on. The
 * app's face is wide with a low x-height, so headlines here run at 112% width
 * and body copy sits just under normal.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const azeret = Azeret_Mono({
  variable: "--font-azeret",
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
  title: "Lift — a workout tracker that lives on your phone",
  description:
    "Every workout, set, routine and record in a real database on the phone. " +
    "Works with no account and no network. Sync is optional and the server is " +
    "in the repository.",
  applicationName: "Lift",
  keywords: [
    "workout tracker",
    "local-first",
    "offline",
    "open source",
    "Android",
    "gym log",
    "self-hosted",
  ],
  openGraph: {
    title: "Lift — a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account required. AGPL-3.0.",
    type: "website",
    siteName: "Lift",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lift — a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account required. AGPL-3.0.",
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
      className={`${archivo.variable} ${azeret.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink text-fg">{children}</body>
    </html>
  );
}
