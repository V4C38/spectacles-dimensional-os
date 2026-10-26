import { validDiagnosticEntry } from "./src/diagnostics/DiagnosticReporter";
import { defineConfig, type Plugin } from "vitest/config";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AR_MODULE_CLIENT_CONFIG } from "../specs/Assets/Scripts/DimOSARClient/websocket/hostPorts";

const clientCore = fileURLToPath(
  new URL("../specs/Assets/Scripts/DimOSARClient", import.meta.url),
);

const OPTIONAL_XR_BLOCKS = [
  "@google/genai",
  "@mediapipe/tasks-audio",
  "@mediapipe/tasks-vision",
  "@sparkjsdev/spark",
  "openai",
  "rapier3d",
];

const OPTIONAL_STUB = "export default {}; export const UI = {};";

function stubOptionalModules(): Plugin {
  return {
    name: "stub-optional-xrblocks",
    enforce: "pre",
    resolveId(id) {
      if (OPTIONAL_XR_BLOCKS.includes(id)) {
        return id;
      }
      return null;
    },
    load(id) {
      if (OPTIONAL_XR_BLOCKS.includes(id)) {
        return OPTIONAL_STUB;
      }
      return null;
    },
  };
}

const arModuleProxy = {
  "/ar": {
    target: `ws://127.0.0.1:${AR_MODULE_CLIENT_CONFIG.port}`,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/ar/, "") || "/",
  },
};

function browserDiagnostics(): Plugin {
  return {
    name: "dimos-browser-diagnostics",
    configureServer(server) {
      server.ws.on("dimos:webxr-diagnostic", (entry) => {
        if (!validDiagnosticEntry(entry)) return;
        const line = JSON.stringify(entry);
        if (line && line.length <= 6000) server.config.logger[entry.level === "debug" ? "info" : entry.level](`[WebXR browser] ${line}`);
      });
    },
  };
}

function buildRevision(): string {
  try {
    const cwd = fileURLToPath(new URL("../..", import.meta.url));
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim();
    return revision + (dirty ? " · dev" : "");
  } catch { return "Unavailable"; }
}

export default defineConfig({
  define: { __DIMOS_BUILD__: JSON.stringify(buildRevision()) },
  plugins: [stubOptionalModules(), basicSsl(), browserDiagnostics()],
  resolve: {
    alias: {
      "@dimos-ar-client": clientCore,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      external: OPTIONAL_XR_BLOCKS,
    },
  },
  server: {
    // Native Lens imports can rewrite shared tsconfig files; test recordings must not reload.
    hmr: process.env.INTEGRATION_RESULTS_DIR ? false : undefined,
    host: true,
    proxy: arModuleProxy,
  },
  preview: {
    host: true,
    proxy: arModuleProxy,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
