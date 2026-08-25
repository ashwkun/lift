#!/usr/bin/env node
/**
 * Takes the screenshots in `screenshots/`.
 *
 * The app is driven in a real browser rather than mocked: `expo start --web` is
 * the same bundle, the same SQLite database and the same screens the phone
 * runs, so what lands in the PNG is the app rather than a picture of one. The
 * year of training behind every figure comes from `sample-log.mjs` and is fed
 * in through the app's own importer, so the volumes, estimated 1RMs and
 * personal records on screen are the ones the app computed.
 *
 *   cd apps/mobile && npx expo start --web        # in one terminal
 *   node scripts/screenshots/capture.mjs          # in another
 *
 * Flags:
 *   --url <origin>     where the dev server is (default http://localhost:8081)
 *   --out <dir>        where the PNGs go (default screenshots/)
 *   --only a,b,c       just these shots, by name
 *   --skip-seed        reuse the database from the last run
 *   --fresh            throw that database away first
 *   --headed           watch it happen
 *
 * The browser profile is kept between runs so `--skip-seed` is possible:
 * seeding is a year of sessions written one at a time and takes minutes, while
 * retaking one screenshot after a style change should take seconds.
 *
 * Playwright is not a dependency of this repository. It is a screenshot tool,
 * not part of the app, so it is fetched on demand:
 *
 *   npm i -g playwright-core && npx playwright install chromium
 *
 * and found through PLAYWRIGHT_CHROMIUM if it lives somewhere unusual.
 */

import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSampleLog, summarise } from './sample-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const URL = args.url ?? 'http://localhost:8081';
const OUT = resolve(ROOT, args.out ?? 'screenshots');
const PROFILE = resolve(ROOT, 'node_modules/.cache/lift-screenshots');

/** A phone, at the size the app is designed against. */
const PHONE = { width: 390, height: 844 };

/** Wide enough to cross the 840px line where the tab bar becomes a side rail. */
const DESKTOP = { width: 1280, height: 860 };

/** Two device pixels per CSS pixel: legible when GitHub scales it down. */
const SCALE = 2;

// ---------------------------------------------------------------------------
// The shots
// ---------------------------------------------------------------------------

/**
 * Each entry is a route and whatever has to be true before it is worth
 * photographing. `settle` is generous on purpose: several of these screens run
 * an analytics scan over three and a half thousand sets on focus, and a
 * screenshot taken mid-scan shows an empty card that the app would have filled.
 *
 * **This is the only set.** There was a second one for the landing page, shot
 * at a taller geometry and written out as WebP, and keeping two photographs of
 * the same screens honest turned out to be one job too many: the page's copy
 * drifted from its own images the first time the app moved. `apps/landing`
 * imports these PNGs directly now, so renaming a shot here renames it in
 * `apps/landing/lib/screens.ts`, and a shot removed from this list is a device
 * that has to come off the page.
 */
const SHOTS = [
  { name: 'home', route: '/', settle: 3500, await: 'This week' },
  { name: 'routines', route: '/workout', settle: 2500 },
  { name: 'history', route: '/history', settle: 3000 },
  { name: 'calendar', route: '/calendar', settle: 3000 },
  { name: 'stats', route: '/stats', settle: 3500 },
  { name: 'records', route: '/records', settle: 3000 },
  { name: 'exercise', route: '/exercise/barbell-bench-press', settle: 3500 },
  { name: 'measurements', route: '/measurements', settle: 3000 },
  { name: 'monthly-report', route: '/stats/monthly-report', settle: 3500 },
  { name: 'profile', route: '/profile', settle: 2500 },
  { name: 'appearance', route: '/settings/appearance', settle: 2000 },
  { name: 'plate-calculator', route: '/plate-calculator', settle: 2000 },

  // The routine editor, scrolled to the pair of accessories the program runs
  // back to back. The superset is the last two exercises of Push A, which is
  // where a superset belongs and also below the fold on a 390pt screen, so this
  // is the one shot that has to scroll to find its subject.
  { name: 'superset', settle: 2500, prepare: openPrescribedSuperset },

  // Last, because it leaves a workout open: everything above it would then be
  // photographed with a resume banner it does not need.
  { name: 'session', route: null, settle: 3000, prepare: openActiveSession },

  // One palette that is not the default, and one that is not even dark, since
  // "nine palettes" is a claim the grid on the appearance screen only half
  // supports: it shows the swatches, not what a screen made of them looks like.
  { name: 'theme-nord', route: '/history', theme: 'nord', settle: 3000 },
  { name: 'theme-solarized', route: '/calendar', theme: 'solarized', settle: 3000 },
];

/**
 * Taken last, at desktop width, from whatever state the run has reached.
 *
 * Kept apart from `SHOTS` because the desktop layout is a claim the README
 * makes and the landing page does not: the page's frames are phone-shaped, and
 * a 1280pt screenshot inside one would be a picture of the wrong app.
 */
const DESKTOP_SHOTS = [
  { name: 'desktop', route: '/', theme: 'dark', settle: 3500 },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const { chromium } = await loadPlaywright();

if (args.fresh && existsSync(PROFILE)) await rm(PROFILE, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(PROFILE, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: chromiumPath(),
  headless: !args.headed,
  args: ['--no-sandbox', '--hide-scrollbars'],
  viewport: PHONE,
  deviceScaleFactor: SCALE,
  // Not `isMobile`: that turns on viewport-meta emulation, which rescales the
  // page. The app decides its layout from the window width alone, so a narrow
  // desktop window is already the phone layout, and touch is the only part of
  // the emulation any of this needs.
  hasTouch: true,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});

await context.addInitScript(RELAX_SYNC_BRIDGE);
await context.addInitScript(MODULE_ACCESSOR);

const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(120_000);
page.on('pageerror', (error) => console.warn('  ! page error:', String(error).split('\n')[0]));

await boot(page);

if (!args.skipSeed) await seed(page);

/*
 * Whatever the last run left running.
 *
 * Both shot lists put the session last precisely because it leaves a workout
 * open, and an open workout puts a resume banner on the home tab and a running
 * session on the workout tab. That reasoning only holds within one run: come
 * back with `--skip-seed` to retake one screenshot and every shot above the
 * session is photographed with the banner the ordering was avoiding.
 */
await discardOpenSession(page);

const wanted = args.only ? new Set(args.only.split(',').map((name) => name.trim())) : null;

for (const shot of SHOTS) {
  if (wanted && !wanted.has(shot.name)) continue;
  await capture(page, shot);
}

if (!wanted || wanted.has('desktop')) {
  await page.setViewportSize(DESKTOP);
  for (const shot of DESKTOP_SHOTS) await capture(page, shot);
}

await context.close();
console.log(`\nWrote to ${OUT}`);

// ---------------------------------------------------------------------------
// Booting
// ---------------------------------------------------------------------------

/**
 * expo-sqlite's synchronous bridge busy-waits on a SharedArrayBuffer with a
 * budget of a million `Atomics.pause()` spins, which is a few tens of
 * milliseconds. On a machine where the worker answers more slowly than that the
 * app cannot get past its migrations: every launch ends on "Sync operation
 * timeout" before a screen has rendered.
 *
 * Removing `Atomics.pause` drops the bridge onto the fallback loop it already
 * has for engines without it, which spins a thousand times as long and gets
 * there. It changes nothing about the app: same queries, same results, same
 * screens. It only buys the worker time to answer.
 */
function RELAX_SYNC_BRIDGE() {
  delete Atomics.pause;
}

/**
 * Reaches into Metro's dev module registry.
 *
 * This is how the seeding below calls the app's own repositories instead of
 * writing SQL of its own. `expo start` registers every module under its source
 * path, so `src/features/import/index.ts` is addressable by name, and requiring
 * it hands back the same exports the app is using. Nothing is stubbed and no
 * code exists in the app for the sake of these screenshots.
 */
function MODULE_ACCESSOR() {
  window.__mod = (name) => {
    for (const [id, module] of globalThis.__r.getModules()) {
      if (module.verboseName === name) return globalThis.__r(id);
    }
    throw new Error(`Module not registered: ${name}`);
  };
}

async function boot(page) {
  process.stdout.write(`Opening ${URL} `);
  await page.goto(URL, { waitUntil: 'load', timeout: 180_000 });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(2500);
    process.stdout.write('.');

    // The bootstrap screen offers a retry when the database fails to open, and
    // remounting is what makes it work. Take it rather than failing the run.
    const retry = page.getByText('Try again', { exact: true });
    if (await retry.count()) {
      await retry.first().click();
      continue;
    }

    const text = await page.evaluate(() => document.body.innerText);
    if (text && !text.includes("Couldn't start")) {
      // Metro's dev build renders a red toast over the app for anything that
      // reaches `console.error`, including navigation warnings that a release
      // build never shows. It is development furniture, not the app, and it
      // has no business in a screenshot.
      await page.evaluate(() => {
        console.error = () => {};
      });

      console.log(' ready');
      return;
    }
  }

  throw new Error('The app never finished starting. Is the dev server running?');
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seed(page) {
  const log = buildSampleLog();
  const totals = summarise(log);

  console.log(
    `\nSeeding ${totals.workouts} sessions, ${totals.sets} sets and ${totals.measurements} ` +
      `measurements (${totals.from} to ${totals.to}, ${totals.volumeTonnes} tonnes lifted).`,
  );

  await page.evaluate((settings) => {
    const { useSettings } = window.__mod('src/store/settings.ts');
    const { update } = useSettings.getState();
    for (const [key, value] of Object.entries(settings)) update(key, value);
  }, log.settings);

  await page.evaluate(async (entries) => {
    const { recordMeasurement } = window.__mod('src/features/measurements/repository.ts');
    for (const entry of entries) {
      await recordMeasurement({
        kind: entry.kind,
        value: entry.value,
        measuredAt: new Date(entry.measuredAt),
      });
    }
  }, log.measurements);
  console.log(`  measurements: ${log.measurements.length}`);

  // Oldest first and in order, because a personal record is a comparison
  // against everything before it. Chunked so a stalled write is visible as a
  // stalled chunk rather than as one silent hour-long call.
  let done = 0;
  let records = 0;

  for (const chunk of chunked(log.workouts, 20)) {
    const summary = await page.evaluate(async (workouts) => {
      const { importWorkouts } = window.__mod('src/features/import/index.ts');
      const result = await importWorkouts(workouts);
      return {
        workouts: result.workouts,
        records: result.personalRecords,
        created: result.exercisesCreated,
        failed: result.failed,
      };
    }, chunk);

    // A name the catalog does not hold becomes a custom exercise, which means
    // the history is being split across two entries for the same lift. That is
    // a bug in `sample-log.mjs`, and it is worth saying so out loud.
    if (summary.created.length > 0) {
      console.warn(`  ! not in the library: ${summary.created.join(', ')}`);
    }
    if (summary.failed > 0) console.warn(`  ! ${summary.failed} sessions failed to write`);

    done += summary.workouts;
    records += summary.records;
    process.stdout.write(`\r  sessions: ${done}/${log.workouts.length}, ${records} records`);
  }

  console.log('');

  const routines = await page.evaluate(async (definitions) => {
    const { db } = window.__mod('src/db/client.ts');
    const { exercises } = window.__mod('src/db/schema.ts');
    const {
      createRoutine,
      addExerciseToRoutine,
      addRoutineSet,
      updateRoutineSet,
      applyRoutineSupersetGroups,
      getRoutineDetail,
    } = window.__mod('src/features/routines/repository.ts');

    const library = await db.select({ id: exercises.id, name: exercises.name }).from(exercises);
    const idByName = new Map(library.map((row) => [row.name.toLowerCase(), row.id]));

    let created = 0;

    for (const definition of definitions) {
      const routine = await createRoutine({ name: definition.name, notes: definition.notes });

      for (const exercise of definition.exercises) {
        const id = idByName.get(exercise.name.toLowerCase());
        if (!id) continue;

        const link = await addExerciseToRoutine(routine.id, id);

        // `addExerciseToRoutine` seeds one set, so the first prescription
        // updates that row and the rest are appended after it.
        const detail = await getRoutineDetail(routine.id);
        const seeded = detail.exercises.find((entry) => entry.routineExercise.id === link.id);

        for (const [index, prescribed] of exercise.sets.entries()) {
          if (index === 0 && seeded?.sets[0]) {
            await updateRoutineSet(seeded.sets[0].id, prescribed);
          } else {
            await addRoutineSet(link.id, prescribed);
          }
        }
      }

      // After every exercise is in place, because a superset is a fact about
      // two rows that have to be next to each other, and the second of them
      // does not exist while the first is being written.
      const grouped = definition.exercises.filter((exercise) => exercise.supersetGroup != null);

      if (grouped.length > 0) {
        const final = await getRoutineDetail(routine.id);
        const writes = final.exercises
          .map((entry) => {
            const source = definition.exercises.find(
              (exercise) => exercise.name.toLowerCase() === entry.exercise.name.toLowerCase(),
            );
            return { id: entry.routineExercise.id, supersetGroup: source?.supersetGroup ?? null };
          })
          .filter((write) => write.supersetGroup != null);

        await applyRoutineSupersetGroups(writes);
      }

      created += 1;
    }

    return created;
  }, log.routines);

  console.log(`  routines: ${routines}`);

  await linkHistoryToRoutines(page);
}

/**
 * Points each imported session at the routine it was run from.
 *
 * The importer cannot do this: a file from another app carries a workout name
 * and nothing else, so `routineId` comes back null and every routine reads
 * "Not performed yet" beside a year of sessions that are plainly performances
 * of it. Here the two sides came out of the same program, and the name is the
 * link. `lastPerformedAt` follows from it, which is what the routine list
 * actually shows.
 *
 * Written as SQL rather than through the repository because there is no
 * repository call for it: nothing in the app ever needs to re-point a finished
 * session at a routine, and inventing one for a screenshot script would be the
 * tail wagging the dog.
 */
async function linkHistoryToRoutines(page) {
  await page.evaluate(async () => {
    const { sqlite } = window.__mod('src/db/client.ts');

    await sqlite.execAsync(`
      update workouts
         set routine_id = (
               select id from routines
                where routines.name = replace(workouts.name, ' (deload)', '')
                  and routines.deleted_at is null
             )
       where routine_id is null
         and finished_at is not null;

      update routines
         set last_performed_at = (
               select max(started_at) from workouts
                where workouts.routine_id = routines.id
                  and workouts.finished_at is not null
             );
    `);
  });
}

// ---------------------------------------------------------------------------
// Capturing
// ---------------------------------------------------------------------------

async function capture(page, shot) {
  if (shot.theme) await setTheme(page, shot.theme);

  if (shot.prepare) await shot.prepare(page);
  else await navigate(page, shot.route);

  await page.waitForTimeout(shot.settle ?? 2000);

  if (shot.await) {
    await page
      .getByText(shot.await, { exact: false })
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => console.warn(`  ! ${shot.name}: never showed "${shot.await}"`));
  }

  // A screen that focuses its own field on open (the plate calculator does)
  // otherwise shows the browser's text selection over its first value, which is
  // a thing the phone does not draw.
  await page.evaluate(() => document.activeElement?.blur?.());

  const file = `${OUT}/${shot.name}.png`;
  await page.screenshot({ path: file });
  console.log(`  ${shot.name}.png`);
}

/**
 * Navigates inside the running app rather than reloading it.
 *
 * A `page.goto` per screen would be a cold start per screen: the worker, the
 * migrations, the settings hydration and a six-thousand-row catalog check,
 * about fifteen seconds each and a fresh chance to trip the sync bridge.
 */
async function navigate(page, route) {
  await page.evaluate((target) => {
    const { router } = window.__mod('../../node_modules/expo-router/build/imperative-api.js');
    router.replace(target);
  }, route);
}

/** Switches palette the way the appearance screen does. */
async function setTheme(page, theme) {
  await page.evaluate((preference) => {
    const { useSettings } = window.__mod('src/store/settings.ts');
    useSettings.getState().update('themePreference', preference);
  }, theme);

  await page.waitForTimeout(500);
}

/** Throws away a session left open by an earlier run. Silent when there is none. */
async function discardOpenSession(page) {
  const discarded = await page.evaluate(async () => {
    const { getActiveWorkout, discardWorkout } = window.__mod(
      'src/features/workouts/repository.ts',
    );

    const open = await getActiveWorkout();
    if (!open) return false;

    await discardWorkout(open.id);
    return true;
  });

  if (discarded) console.log('  discarded a session left open by an earlier run');
}

/**
 * Opens the routine that prescribes a superset, scrolled to it.
 *
 * The scroll is done by the page rather than by a gesture: `page.mouse.wheel`
 * on a react-native-web ScrollView lands on whichever element is under the
 * cursor, and the one under the middle of this screen is a number field.
 */
async function openPrescribedSuperset(page) {
  const routineId = await page.evaluate(async () => {
    const { db } = window.__mod('src/db/client.ts');
    const { routines, routineExercises } = window.__mod('src/db/schema.ts');

    // Whichever routine actually carries a grouping, rather than the one that
    // happens to be first: `sample-log.mjs` may move it.
    const links = await db
      .select({ routineId: routineExercises.routineId, group: routineExercises.supersetGroup })
      .from(routineExercises);

    return links.find((link) => link.group !== null)?.routineId ?? null;
  });

  if (!routineId) {
    console.warn('  ! superset: no routine prescribes one');
    return;
  }

  await navigate(page, `/routine/${routineId}`);
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    for (const node of document.querySelectorAll('div')) {
      if (node.scrollHeight > node.clientHeight + 40) node.scrollTop = node.scrollHeight;
    }
  });
}

/**
 * Starts a session from the first routine and logs the opening exercise, so the
 * screenshot of the logging screen shows a workout underway rather than an
 * untouched template: sets checked off, the rest of the session still to do.
 */
async function openActiveSession(page) {
  await page.evaluate(async () => {
    const { db, sqlite } = window.__mod('src/db/client.ts');
    const { routines } = window.__mod('src/db/schema.ts');
    const { startWorkout, getWorkoutDetail, updateSet, getActiveWorkout } = window.__mod(
      'src/features/workouts/repository.ts',
    );

    const open = await getActiveWorkout();
    const [routine] = await db.select().from(routines).limit(1);
    const workout = open ?? (await startWorkout({ routineId: routine.id }));

    const detail = await getWorkoutDetail(workout.id);

    // The first two exercises are done, the third is where the session is now.
    for (const [index, entry] of detail.exercises.slice(0, 2).entries()) {
      for (const set of entry.sets) {
        await updateSet(set.id, {
          isCompleted: true,
          weightKg: set.weightKg,
          reps: set.reps,
          rpe: index === 0 ? 8 : null,
        });
      }
    }

    // Seven exercises' worth of work does not happen in the two seconds since
    // `startWorkout` ran, and the elapsed clock at the top of the screen says
    // so. Move the start back to when a session in this state would have begun.
    await sqlite.runAsync('update workouts set started_at = ? where id = ?', [
      Date.now() - 37 * 60_000,
      workout.id,
    ]);
  });

  await navigate(page, '/workout/active');
}

// ---------------------------------------------------------------------------
// Odds and ends
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;

    const key = flag.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
    const next = argv[i + 1];

    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function* chunked(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * Playwright, from wherever it happens to be installed.
 *
 * The `require` fallback is the one that matters: it honours `NODE_PATH`, which
 * an ESM `import` does not, so a copy installed anywhere at all can be pointed
 * at without touching this repository's dependencies.
 */
async function loadPlaywright() {
  const require = createRequire(import.meta.url);

  const candidates = [
    () => import('playwright-core'),
    () => import('playwright'),
    () => require('playwright-core'),
    () => require('playwright'),
  ];

  for (const candidate of candidates) {
    try {
      return await candidate();
    } catch {
      // Try the next one.
    }
  }

  throw new Error(
    'Playwright not found. Install it (npm i -g playwright-core && npx playwright install ' +
      'chromium), or point NODE_PATH at a copy.',
  );
}

/**
 * Chromium's own path, which playwright-core only knows when it was installed
 * as a dependency of the project it is driving. Here it usually is not.
 */
function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;

  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  if (!existsSync(cache)) return undefined;

  const build = readdirSync(cache)
    .filter((entry) => entry.startsWith('chromium-'))
    .sort()
    .pop();

  const binary = build && `${cache}/${build}/chrome-linux64/chrome`;
  return binary && existsSync(binary) ? binary : undefined;
}
