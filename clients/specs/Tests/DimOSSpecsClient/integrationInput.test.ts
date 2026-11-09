import { afterEach, expect, it, vi } from "vitest";
import { IntegrationInput } from "../integration-tests/IntegrationInput";
import { setMockInteractors } from "../mocks/InteractionManager";

afterEach(() => setMockInteractors([]));

it("exposes configurable rotation through the registered interactor and restores its original descriptor", () => {
  const original = quat.quatIdentity();
  const actor: any = { orientation: original, isActive: () => true, isTargeting: () => true };
  setMockInteractors([actor]);
  const input = new IntegrationInput();
  const rotation = new quat(Math.cos(.2), 0, Math.sin(.2), 0);
  input.orientation = rotation;
  expect(actor.orientation).toBe(rotation);
  input.restore();
  expect(actor.orientation).toBe(original);
});

it("delivers native trigger events and samples input while held and after release", () => {
  const actor: any = { isActive: () => true, isTargeting: () => true };
  setMockInteractors([actor]);
  const input = new IntegrationInput();
  const events: string[] = [];
  const interactable: any = {
    enabled: true, getSceneObject: () => ({ name: "Gripper", isEnabledInHierarchy: true }),
    hoverEnter: () => events.push("hover"), hoverUpdate: vi.fn(), hoverExit: () => events.push("unhover"),
    triggerStart: () => events.push("start"), triggerEnd: () => events.push("end"), triggerCanceled: vi.fn(),
  };
  input.press({ interactable }, () => events.push(`sample-${actor.isTriggering}`));
  expect(events).toEqual(["hover", "start", "sample-true", "end", "sample-false", "unhover"]);
  input.restore();
});
