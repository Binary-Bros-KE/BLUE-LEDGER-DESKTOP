// The package is "type": "commonjs", so Node would read these TypeScript files as CommonJS; this
// marks every .ts file as an ES module so `node --test` can strip the types and run them directly.
import { register } from "node:module";

register("./ts-esm-loader.mjs", import.meta.url);
