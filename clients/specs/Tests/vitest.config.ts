import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const uikitMock = fileURLToPath(new URL("./mocks/UIKit.ts", import.meta.url));
const animateMock = fileURLToPath(new URL("./mocks/animate.ts", import.meta.url));
const interactorLineRendererMock = fileURLToPath(
  new URL("./mocks/InteractorLineRenderer.ts", import.meta.url),
);
const interactableMock = fileURLToPath(new URL("./mocks/Interactable.ts", import.meta.url));
const roundButtonMock = fileURLToPath(new URL("./mocks/RoundButton.ts", import.meta.url));

function isUIKitImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /(?:\.\/)?(?:App\/)?UI\/UIKit(\.ts)?$/.test(normalized);
}

function isAnimateImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /SpectaclesInteractionKit\.lspkg\/Utils\/animate$/.test(normalized);
}

function isInteractorLineRendererImport(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  return /SpectaclesInteractionKit\.lspkg\/Components\/Interaction\/InteractorLineVisual\/InteractorLineRenderer$/.test(
    normalized,
  );
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
      name: "uikit-mock",
      resolveId(source) {
        if (isUIKitImport(source)) {
          return uikitMock;
        }
        if (isAnimateImport(source)) {
          return animateMock;
        }
        if (isInteractorLineRendererImport(source)) {
          return interactorLineRendererMock;
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
      "./UI/UIKit": uikitMock,
      "./UIKit": uikitMock,
      "../App/UI/UIKit": uikitMock,
      "../../App/UI/UIKit": uikitMock,
      "../UI/UIKit": uikitMock,
      "../../UI/UIKit": uikitMock,
      "SpectaclesInteractionKit.lspkg/Utils/animate": animateMock,
      "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractorLineVisual/InteractorLineRenderer":
        interactorLineRendererMock,
      "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable":
        interactableMock,
      "SpectaclesUIKit.lspkg/Scripts/Components/Button/RoundButton": roundButtonMock,
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["unit/**/*.test.ts", "core/**/*.test.ts"],
    setupFiles: ["./setup/lens-globals.ts"],
    coverage: {
      provider: "v8",
      allowExternal: true,
      include: [
        "../Assets/Scripts/ARBridge/Network/Protocol.ts",
        "../Assets/Scripts/App/AppState.ts",
        "../Assets/Scripts/App/Utilities/Utilities.ts",
        "../Assets/Scripts/App/Robot/RobotRuntimeModel.ts",
        "../Assets/Scripts/ARBridge/Navigation/NavigationModel.ts",
        "../Assets/Scripts/DimosARClient/core/**/*.ts",
      ],
    },
  },
});
