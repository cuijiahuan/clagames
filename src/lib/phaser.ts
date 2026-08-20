/// <reference types="phaser" />
// Phaser 3.90's ESM build (the `module` entry) exposes only webpack-mangled
// named exports and no `default`, so `import Phaser from "phaser"` resolves to
// `undefined` under Next's bundlers. The UMD build (`dist/phaser.js`) does
// `module.exports = Phaser`, which resolves cleanly as a default import.
//
// This shim re-exports that UMD value typed as Phaser's ambient global
// namespace, so callers can `import Phaser from "@/lib/phaser"` and use both
// the runtime value (`new Phaser.Game`) and the types (`Phaser.Scene`).
import PhaserUMD from "phaser/dist/phaser.js";

const PhaserLib = PhaserUMD as unknown as typeof Phaser;

export default PhaserLib;
