import { beforeEach, expect, it } from "vitest";
import { readSikLaserPointers } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SpecsLaserInput";
import { setMockInteractors } from "../mocks/InteractionManager";
import { setMockCursor, clearMockCursors } from "../mocks/CursorControllerProvider";
import { setMockHands } from "../mocks/HandInputData";
import { InteractorInputType, TargetingMode } from "../mocks/Interactor";

function fixture(inputType = InteractorInputType.LeftHand) {
  let tracked = true;
  setMockHands({ left: { isTracked: () => tracked, isFacingCamera: () => false, getPalmPitchAngle: () => 0 } });
  const interactor = { inputType, startPoint: new vec3(1, 2, 3), direction: new vec3(0, 0, -1),
    isActive: () => true, isTargeting: () => true, activeTargetingMode: TargetingMode.Indirect,
    targetHitPosition: new vec3(0, 0, -200), currentInteractable: {} as object | null };
  const pass = { masterAlpha: 0.7 };
  const cursor = { enabled: true, blendFactor: 0.4, rayAlpha: 0,
    visual: { getComponent: () => ({ mainPass: pass }) },
    getSceneObject: () => ({ isEnabledInHierarchy: true }),
    cursorParameters: { worldPosition: new vec3(4, 5, -100), isShown: true } };
  setMockInteractors([interactor]); setMockCursor(interactor, cursor);
  return { interactor, cursor, pass, loseTracking: () => { tracked = false; } };
}

beforeEach(() => {
  clearMockCursors(); setMockInteractors([]); setMockHands({});
  (globalThis as any).deviceInfoSystem = { isEditor: () => false };
});

it("samples the actual rendered cursor position and material alpha", () => {
  fixture();
  expect(readSikLaserPointers()).toEqual([{ id: 1, active: true, origin: [1, 2, 3],
    cursor: [4, 5, -100], shown: true, opacity: 0.7 }]);
});

it("mirrors cursor visibility even when SIK has no exact hovered target", () => {
  const h = fixture(); h.interactor.currentInteractable = null;
  expect(h.cursor.cursorParameters.isShown).toBe(true);
  expect(readSikLaserPointers()[0].shown).toBe(true);
});

it("hides on tracking loss, direct/poke mode, disabled input and disabled cursor", () => {
  const h = fixture();
  h.interactor.activeTargetingMode = TargetingMode.Direct;
  expect(readSikLaserPointers()[0].active).toBe(false);
  h.interactor.activeTargetingMode = TargetingMode.Poke;
  expect(readSikLaserPointers()[0].active).toBe(false);
  h.interactor.activeTargetingMode = TargetingMode.Indirect;
  h.cursor.enabled = false; expect(readSikLaserPointers()[0].active).toBe(false);
  h.cursor.enabled = true; h.loseTracking(); expect(readSikLaserPointers()[0].active).toBe(false);
});

it("waits for cursor registration and ignores missing ray data", () => {
  const h = fixture(); clearMockCursors(); expect(readSikLaserPointers()).toEqual([]);
  setMockCursor(h.interactor, h.cursor);
  (h.interactor as any).startPoint = null;
  expect(readSikLaserPointers()).toEqual([]);
});

it("does not add an independent visibility rule when native cursor and ray blend", () => {
  const h = fixture(); h.cursor.rayAlpha = 0.4;
  expect(readSikLaserPointers()[0].shown).toBe(true);
  h.cursor.cursorParameters.isShown = false;
  expect(readSikLaserPointers()[0].shown).toBe(false);
  h.cursor.rayAlpha = 0;
  expect(readSikLaserPointers()[0].active).toBe(true);
});

it("supports the editor mouse without requiring tracked hands", () => {
  (globalThis as any).deviceInfoSystem = { isEditor: () => true };
  const h = fixture(InteractorInputType.Mouse); h.loseTracking();
  expect(readSikLaserPointers()[0].active).toBe(true);
});

it("uses the tracked fingertip midpoint for the optical beam without changing native targeting", () => {
  const h = fixture();
  setMockHands({ left: { isTracked: () => true, isFacingCamera: () => false, getPalmPitchAngle: () => 0,
    indexTip: { position: new vec3(12, 8, -20) }, thumbTip: { position: new vec3(8, 4, -24) } } });
  expect(readSikLaserPointers()[0].origin).toEqual([10, 6, -22]);
  expect(h.interactor.startPoint).toEqual(new vec3(1, 2, 3));
  expect(readSikLaserPointers()[0].cursor).toEqual([4, 5, -100]);
});
