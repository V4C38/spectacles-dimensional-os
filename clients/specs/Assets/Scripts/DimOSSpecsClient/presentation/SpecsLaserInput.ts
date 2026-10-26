import { InteractionManager } from "SpectaclesInteractionKit.lspkg/Core/InteractionManager/InteractionManager";
import { InteractorInputType, TargetingMode } from "SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor";
import { CursorControllerProvider } from "SpectaclesInteractionKit.lspkg/Providers/CursorControllerProvider/CursorControllerProvider";
import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import type { LaserPointer } from "./CursorLaserGeometry";

/** Sample after SIK's late cursor update. Cursor parameters are the actual rendered endpoint. */
export function readSikLaserPointers(): LaserPointer[] {
  const editor = global.deviceInfoSystem.isEditor();
  const mask = InteractorInputType.BothHands | (editor ? InteractorInputType.Mouse : 0);
  const cursors = CursorControllerProvider.getInstance();
  const pointers: LaserPointer[] = [];
  for (const interactor of InteractionManager.getInstance().getInteractorsByType(mask)) {
    const cursor = cursors.getCursorByInteractor(interactor);
    const origin = interactor.startPoint;
    if (!cursor || !origin) continue;
    const parameters = cursor.cursorParameters;
    const visual = cursor.visual.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    const handType = interactor.inputType === InteractorInputType.LeftHand ? "left" : "right";
    const tracked = interactor.inputType === InteractorInputType.Mouse ||
      HandInputData.getInstance().getHand(handType).isTracked();
    pointers.push({ id: interactor.inputType,
      active: tracked && interactor.isActive() && interactor.isTargeting() && cursor.enabled &&
        cursor.getSceneObject().isEnabledInHierarchy && interactor.activeTargetingMode === TargetingMode.Indirect,
      origin: [origin.x, origin.y, origin.z],
      cursor: [parameters.worldPosition.x, parameters.worldPosition.y, parameters.worldPosition.z],
      // Match the rendered cursor, including SIK's own visibility/alpha transitions.
      shown: parameters.isShown, opacity: visual.mainPass.masterAlpha });
  }
  return pointers;
}
