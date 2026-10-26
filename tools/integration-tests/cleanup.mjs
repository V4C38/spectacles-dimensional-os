import { removeOldResults } from "./artifacts.mjs";
const args = process.argv.slice(2);
const root = args[args.indexOf("--root") + 1],
  keep = args[args.indexOf("--keep") + 1];
if (!args.includes("--root") || !args.includes("--keep"))
  throw new Error(
    "Usage: cleanup.mjs --root integration-tests/test-results --keep run-id",
  );
await removeOldResults(root, [keep]);
