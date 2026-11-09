import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    include: ["DimOSARClient/**/*.test.ts", "DimOSSpecsClient/**/*.test.ts", "naming.test.ts"],
    setupFiles: ["./setup/lens-globals.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: fileURLToPath(new URL("../../../Review Data/coverage/specs", import.meta.url)),
      allowExternal: true,
      include: [
        "../Assets/Scripts/DimOSARClient/**/*.ts",
        "../Assets/Scripts/DimOSSpecsClient/**/*.ts",
      ],
    },
  },
});
