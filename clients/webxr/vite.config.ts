import { defineConfig, type Plugin } from "vitest/config";
import basicSsl from "@vitejs/plugin-basic-ssl";
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
  "three-mesh-bvh",
  "troika-three-text",
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

export default defineConfig({
  plugins: [stubOptionalModules(), basicSsl()],
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
