/** Drizzle migrations are imported as raw SQL strings via babel-plugin-inline-import. */
declare module '*.sql' {
  const content: string;
  export default content;
}
