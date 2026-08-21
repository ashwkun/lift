import { GitHubMark } from "@/components/site/icons";
import { Wordmark } from "@/components/site/mark";
import { links } from "@/lib/site";

const COLUMNS = [
  {
    heading: "Project",
    items: [
      { label: "Source", href: links.repo },
      { label: "Releases", href: links.releases },
      { label: "Read me", href: links.readme },
      { label: "Issues", href: links.issues },
    ],
  },
  {
    heading: "Licence",
    /*
     * `Third-party notices` is not an ordinary link. The app's anatomical
     * artwork and its volume-landmark model derive from LiftShift under
     * AGPL-3.0, and NOTICE.md is where that attribution lives. This footer used
     * to restate it in prose; that came out, and the link is what carries it
     * now. Do not drop this row.
     */
    items: [
      { label: "AGPL-3.0", href: links.licence },
      { label: "Third-party notices", href: links.notices },
      { label: "Build workflow", href: links.workflow },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto">
      <div className="shell py-16">
        <div className="grid gap-12 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-20">
          <div>
            <Wordmark id="mark-footer" />
            <p className="mt-5 max-w-[42ch] text-[0.9375rem] leading-relaxed text-fg-2">
              A local-first workout tracker. Everything works offline; an account
              is optional and only adds backup and cross-device sync.
            </p>
            <a
              href={links.repo}
              className="underline-draw mt-6 inline-flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-volt"
            >
              <GitHubMark className="size-4" />
              github.com/pawan67/lift
            </a>
          </div>

          <div className="flex gap-16">
            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <p className="label text-fg-3">{column.heading}</p>
                <ul className="mt-5 space-y-3">
                  {column.items.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        className="underline-draw text-sm text-fg-2 transition-colors hover:text-fg"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

      </div>
    </footer>
  );
}
