import { ArrowUpRight } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { links } from "@/lib/site";

/*
 * The self-hosting pitch, and the only code on the page.
 *
 * It sits directly under the sync section on purpose. That section spends its
 * whole length saying an account is optional; this one answers the question a
 * reader has by the end of it, which is what happens to the training log of
 * anybody who does want one. "You can run the server" is the answer, and it is
 * worth more than a clause at the end of a paragraph, which is what it used to
 * be.
 *
 * A terminal block rather than a phone, because this is the one section
 * addressed to somebody who runs machines: it is the only object on the page
 * that would look at home in a readme, and it is deliberately the only one.
 * Nothing in it is invented. The file is `docker-compose.dokploy.yml`, the
 * three services and their ports are the ones it defines, and Postgres is
 * absent from the list because it is absent from the file.
 */
const SERVICES = [
  { name: "api", port: "3000", role: "the sync server the phone talks to" },
  { name: "web", port: "80", role: "the same app, laid out for a browser" },
  { name: "landing", port: "3000", role: "this page" },
];

export function SelfHost() {
  return (
    <section id="self-host" className="border-b border-line py-24 sm:py-32">
      <div className="shell">
        {/*
          `min-w-0` on both halves, and it is load-bearing rather than
          defensive. A grid item's automatic minimum size is its content's
          min-content width, and the shell command below is a `pre` that has
          no smaller size to give: without this the track is set by the width
          of that one line, and on a phone it drags every paragraph in the
          section out past the edge of the screen with it.
        */}
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
          <div className="min-w-0">
            <p className="label text-fg-3">Run your own</p>
            <h2 className="display mt-5 text-[clamp(1.9rem,4vw,3.1rem)] text-balance">
              If you want sync, be the server.
            </h2>

            <div className="mt-7 space-y-6 text-[1.0625rem] leading-[1.75] text-fg-2">
              <p>
                The thing a signed-in phone talks to is a small service in front
                of Postgres, in this repository, under the same licence as the
                app. It depends on nothing that has to be signed up for first:
                no queue, no object store, no mailer, no third-party anything.
                A database and a container.
              </p>
              <p>
                Migrations are applied before it starts listening, and one that
                fails takes the container down rather than answering requests
                against a half-applied schema. The healthcheck round-trips to
                the database instead of returning a static 200, so a deploy that
                reports healthy is one that can actually store a set. Six
                settings are required and the stack refuses to start without
                them rather than inventing defaults, which is how a
                misconfiguration announces itself at deploy time instead of at
                the gym.
              </p>
              <p>
                Pointing the app at it is one variable at build time:{" "}
                <span className="figure text-[0.9375rem] text-fg">API_URL</span>{" "}
                for the APK,{" "}
                <span className="figure text-[0.9375rem] text-fg">
                  EXPO_PUBLIC_API_URL
                </span>{" "}
                for the web build. Both are compiled into the bundle rather than
                read at runtime, so moving the server is a rebuild and not a
                restart.
              </p>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-10 gap-y-4">
              <a
                href={links.selfHosting}
                className="underline-draw inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-volt"
              >
                Everything a deploy needs
                <ArrowUpRight className="size-4" />
              </a>
              <a
                href={links.api}
                className="underline-draw inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-fg-2 transition-colors hover:text-fg"
              >
                Read the server
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>

          <Reveal delay={90} className="min-w-0">
            {/*
              The command scrolls rather than wraps. A wrapped shell line reads
              as two commands, and this one is meant to be copied whole.
            */}
            <div className="rounded-2xl border border-line bg-surface p-7 sm:p-9">
              <div className="rail overflow-x-auto rounded-xl bg-ink px-5 py-4">
                <code className="figure text-[0.8125rem] whitespace-pre text-fg sm:text-sm">
                  <span className="text-volt select-none">$ </span>
                  docker compose -f docker-compose.dokploy.yml up -d
                </code>
              </div>

              <ul className="mt-8 space-y-5">
                {SERVICES.map((service) => (
                  <li
                    key={service.name}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
                  >
                    <span className="figure w-20 shrink-0 text-[0.875rem] text-volt">
                      {service.name}
                    </span>
                    <span className="figure w-11 shrink-0 text-[0.8125rem] text-fg-3">
                      :{service.port}
                    </span>
                    {/*
                      `flex-1`, not `basis-0`. A zero basis with no grow lets
                      the gloss shrink to its longest word, which sets each of
                      these three lines as a column one word wide.
                    */}
                    <span className="basis-full pl-24 text-[0.9375rem] leading-[1.6] text-fg-2 sm:flex-1 sm:basis-auto sm:pl-0">
                      {service.role}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-8 border-t border-line pt-6 text-[0.9375rem] leading-[1.7] text-fg-3">
                Postgres is not on that list because it is not in the file. It
                is whichever database you already run, named by{" "}
                <span className="figure text-[0.875rem] text-fg-2">
                  DATABASE_URL
                </span>
                , so the backups you already take cover your training history
                too.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
