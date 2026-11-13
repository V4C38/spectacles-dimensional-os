import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const tools = fileURLToPath(new URL("../tools/", import.meta.url));
execFileSync("python3", [join(tools, "core_package.py"), "check"], { stdio: "inherit" });
const archive = fileURLToPath(new URL("../Packages/DimOSARClient.lspkg", import.meta.url));
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
const packagedCore = fileURLToPath(new URL("../../../Review Data/unit/specs/package-source/" + digest, import.meta.url));
execFileSync("python3", [join(tools, "core_package.py"), "extract", "--destination", packagedCore], { stdio: "inherit" });
const rawCore = fileURLToPath(new URL("../../core/src/", import.meta.url));

const uikitMock = fileURLToPath(new URL("./mocks/UIKit.ts", import.meta.url));
const animateMock = fileURLToPath(new URL("./mocks/animate.ts", import.meta.url));
const interactableMock = fileURLToPath(new URL("./mocks/Interactable.ts", import.meta.url));
const roundButtonMock = fileURLToPath(new URL("./mocks/RoundButton.ts", import.meta.url));
const handInputDataMock = fileURLToPath(new URL("./mocks/HandInputData.ts", import.meta.url));

function isUIKitImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /(?:\.\/)?DimOSSpecsClient\/presentation\/UIKit(\.ts)?$/.test(
    normalized,
  );
}

function isAnimateImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /SpectaclesInteractionKit\.lspkg\/Utils\/animate$/.test(normalized);
}

function isInteractableImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /SpectaclesInteractionKit\.lspkg\/Components\/Interaction\/Interactable\/Interactable$/.test(
    normalized,
  );
}

function isRoundButtonImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /SpectaclesUIKit\.lspkg\/Scripts\/Components\/Button\/RoundButton$/.test(normalized);
}

export default defineConfig({
  plugins: [
    {
      name: "packaged-core",
      enforce: "pre",
      resolveId(source, importer) {
        if (source.startsWith("DimOSARClient.lspkg/Scripts/DimOSARClient/")) {
          const target = join(packagedCore, source.slice("DimOSARClient.lspkg/Scripts/DimOSARClient/".length));
          return target.endsWith(".ts") ? target : target + ".ts";
        }
        // Shared fixtures use source-relative imports in Core's own test job.
        // Specs must exercise the installed package even through those fixtures.
        if (importer && source.startsWith(".")) {
          const target = resolve(dirname(importer), source);
          const path = relative(rawCore, target);
          if (path !== ".." && !path.startsWith(".." + sep) && !path.startsWith(sep)) {
            const packaged = join(packagedCore, path);
            return packaged.endsWith(".ts") ? packaged : packaged + ".ts";
          }
        }
        return null;
      },
    },
    {
      name: "lens-text-input-module",
      transform(code, id) {
        if (id.endsWith("/SetupWizardController.ts")) {
          // Lens permission registration has no Node equivalent; the wizard
          // view and its text input are mocked in controller tests.
          return code.replace('require("LensStudio:TextInputModule");', "");
        }
        return null;
      },
    },
    {
      name: "uikit-mock",
      resolveId(source) {
        if (isUIKitImport(source)) {
          return uikitMock;
        }
        if (isAnimateImport(source)) {
          return animateMock;
        }
        if (isInteractableImport(source)) {
          return interactableMock;
        }
        if (isRoundButtonImport(source)) {
          return roundButtonMock;
        }
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame": fileURLToPath(new URL("./mocks/Frame.ts", import.meta.url)),
      "./UIKit": uikitMock,
      "../DimOSSpecsClient/presentation/UIKit": uikitMock,
      "../../DimOSSpecsClient/presentation/UIKit": uikitMock,
      "../presentation/UIKit": uikitMock,
      "../../presentation/UIKit": uikitMock,
      "../DimOSSpecsClient/utilities/AnimationUtilities": fileURLToPath(
        new URL("../Assets/Scripts/DimOSSpecsClient/utilities/AnimationUtilities.ts", import.meta.url),
      ),
      "SpectaclesInteractionKit.lspkg/Utils/animate": animateMock,
      "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager": fileURLToPath(new URL("./mocks/InteractionManager.ts", import.meta.url)),
      "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor": fileURLToPath(new URL("./mocks/Interactor.ts", import.meta.url)),
      "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider": fileURLToPath(new URL("./mocks/CursorControllerProvider.ts", import.meta.url)),
      "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable":
        interactableMock,
      "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton": roundButtonMock,
      "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData": handInputDataMock,
      "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandType":
        handInputDataMock,
    },
  },
  test: {
    environment: "node",
    globals: true,
    reporters: ["default", "json"],
    outputFile: { json: fileURLToPath(new URL("../../../Review Data/unit/specs/results.json", import.meta.url)) },
    include: ["DimOSSpecsClient/**/*.test.ts"],
    setupFiles: ["./setup/lens-globals.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: fileURLToPath(new URL("../../../Review Data/coverage/specs", import.meta.url)),
      allowExternal: true,
      include: [
        packagedCore + "/**/*.ts",
        "../Assets/Scripts/DimOSSpecsClient/**/*.ts",
      ],
    },
  },
});
