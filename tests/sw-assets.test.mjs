import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const files = readdirSync(new URL("../js/", import.meta.url)).filter((f) =>
  f.endsWith(".js"),
);
const missing = files.filter((f) => !sw.includes(`"./js/${f}"`));
assert.deepEqual(missing, [], "sw.js ASSETS içinde eksik modül: " + missing);
console.log("sw-assets OK (" + files.length + " modül)");
