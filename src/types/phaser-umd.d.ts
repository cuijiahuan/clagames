// Phaser's UMD build (`dist/phaser.js`) has no bundled type declarations; the
// typed surface comes from the package's ambient global namespace instead.
// We declare the module as `any` here, and `src/lib/phaser.ts` casts it to the
// typed global so callers keep full type safety.
declare module "phaser/dist/phaser.js";
