export * from './ids.ts';
export * from './types.ts';
export * from './units.ts';
export * from './calculations.ts';
export * from './plates.ts';
export * from './sync.ts';

// The exercise catalog is deliberately *not* re-exported here. It is ~6,800
// rows of generated data, and a barrel export pulled it into the module graph
// of every screen that wanted a unit conversion or a colour token. It has its
// own entry point instead: `@lift/shared/exercises`, declared in this package's
// exports map. Two files need it — the seeder and the exercise repository.
