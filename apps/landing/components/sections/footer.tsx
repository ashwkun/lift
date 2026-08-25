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
    heading: "Self-hosting",
    items: [
      { label: "Deploy guide", href: links.selfHosting },
      { label: "The sync server", href: links.api },
      { label: "Compose file", href: links.compose },
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
        {/*
          `lg` rather than `sm` for the split. Three link columns beside a
          paragraph at 42 characters is more than 640px holds, and the failure
          is the paragraph collapsing to a word per line rather than anything
          obvious about the columns.
        */}
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          <div>
            <Wordmark id="mark-footer" />
            <p className="mt-5 max-w-[42ch] text-[0.9375rem] leading-relaxed text-fg-2">
              A local-first workout tracker. Everything works offline, nothing
              in it is tracked, and an account is optional: all it adds is a
              backup and a second device, on a server you can run yourself.
            </p>
            <a
              href={links.repo}
              className="underline-draw mt-6 inline-flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-volt"
            >
              <GitHubMark className="size-4" />
              github.com/pawan67/lift
            </a>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-3 sm:gap-x-14">
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
