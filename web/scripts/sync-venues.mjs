// Keep the web app's venue adapters identical to the plugin's: copies ../src/venues.ts to api/_venues.ts.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("../../src/venues.ts", import.meta.url), "utf8");
writeFileSync(new URL("../api/_venues.ts", import.meta.url), src.replace('"market-radar-paybox-plugin"', '"market-radar-near"'));
console.log("api/_venues.ts updated from src/venues.ts");
