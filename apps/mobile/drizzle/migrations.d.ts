/**
 * Type surface for the drizzle-kit generated `migrations.js` bundle, which is
 * plain JS and therefore invisible to TypeScript on its own.
 */
declare const migrations: {
  journal: {
    entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
  };
  migrations: Record<string, string>;
};

export default migrations;
