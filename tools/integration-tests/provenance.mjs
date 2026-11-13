// Narrow JSON bridge for the Python native lifecycle. Manifest policy lives in artifacts.mjs.
import { readFileSync } from "node:fs";
import {
  sourceIdentity, nativeProjectFiles, beginNativeProvenance,
  beforeNativeSceneOverlay, recordNativeSceneOverlay, nativeProvenanceMatches,
} from "./artifacts.mjs";

const request = JSON.parse(readFileSync(0, "utf8"));
let result;
switch (request.operation) {
  case "source-identity": result = sourceIdentity(request.root); break;
  case "project-files": result = nativeProjectFiles(request.root); break;
  case "begin": result = beginNativeProvenance(request.source, request.workspace, request.canonical); break;
  case "before-overlay": result = beforeNativeSceneOverlay(request.value); break;
  case "record-overlay": result = recordNativeSceneOverlay(request.value); break;
  case "matches": result = nativeProvenanceMatches(request.value, request.canonical); break;
  default: throw new Error(`Unknown provenance operation: ${request.operation}`);
}
process.stdout.write(JSON.stringify(result) + "\n");
