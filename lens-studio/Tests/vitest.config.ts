import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const uikitMock = fileURLToPath(new URL("./mocks/UIKit.ts", import.meta.url));

function isUIKitImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /UI\/kit\/UIKit(\.ts)?$/.test(normalized);
}

export default defineConfig({
  plugins: [
    {
      name: "uikit-mock",
      resolveId(source) {
        if (isUIKitImport(source)) {
          return uikitMock;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      "../UI/kit/UIKit": uikitMock,
      "../../UI/kit/UIKit": uikitMock,
      "./kit/UIKit": uikitMock,
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["unit/**/*.test.ts"],
    setupFiles: ["./setup/lens-globals.ts"],
    coverage: {
      provider: "v8",
      include: [
        "../Assets/Scripts/Bridge/Protocol.ts",
        "../Assets/Scripts/Core/AppState.ts",
        "../Assets/Scripts/Core/Utilities.ts",
        "../Assets/Scripts/Robot/RobotRuntimeModel.ts",
      ],
    },
  },
});
