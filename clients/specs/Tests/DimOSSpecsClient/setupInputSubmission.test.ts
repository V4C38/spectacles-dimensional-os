import { expect, it, vi } from "vitest";
import { SetupWizardView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/SetupWizardView";

function fixture() {
  const onInputEdit = vi.fn(), onInputSubmit = vi.fn();
  const view = Object.assign(Object.create(SetupWizardView.prototype), {
    disposed: false, step: "connect", inputVisible: true, inputEnabled: true, inputCycleActive: false, inputSubmitted: false,
    handlers: { onInputEdit, onInputSubmit },
  });
  return { view, onInputEdit, onInputSubmit };
}

it.each(["return-first", "close-first"])("submits only once per edit cycle (%s)", order => {
  const h = fixture();
  h.view.beginInputEdit(); h.view.keyboardStateChanged(true);
  if (order === "return-first") h.view.submitInput();
  h.view.keyboardStateChanged(false);
  h.view.submitInput(); h.view.keyboardStateChanged(false);
  expect(h.onInputEdit).toHaveBeenCalledOnce();
  expect(h.onInputSubmit).toHaveBeenCalledOnce();
  h.view.keyboardStateChanged(true); h.view.beginInputEdit();
  h.view.keyboardStateChanged(false);
  expect(h.onInputEdit).toHaveBeenCalledTimes(2);
  expect(h.onInputSubmit).toHaveBeenCalledTimes(2);
});

it("ignores keyboard closes outside editing and late events after hiding", () => {
  const h = fixture();
  h.view.keyboardStateChanged(false); h.view.submitInput();
  expect(h.onInputSubmit).not.toHaveBeenCalled();
  h.view.beginInputEdit();
  h.view.setCameraPreview = vi.fn();
  h.view.heightController = { setVisible: vi.fn() };
  h.view.setVisible(false); h.view.keyboardStateChanged(false); h.view.submitInput();
  expect(h.onInputSubmit).not.toHaveBeenCalled();
});

it("ignores editing after disposal or outside the connection step", () => {
  const h = fixture();
  h.view.step = "localization"; h.view.beginInputEdit();
  h.view.step = "connect"; h.view.disposed = true; h.view.keyboardStateChanged(true);
  expect(h.onInputEdit).not.toHaveBeenCalled();
  expect(h.onInputSubmit).not.toHaveBeenCalled();
});

it.each(["hidden", "disabled"])("ignores late keyboard open/close after input becomes %s", state => {
  const h = fixture();
  h.view.setCameraPreview = vi.fn();
  h.view.heightController = { setVisible: vi.fn() };
  h.view.input = { enabled: true, getSceneObject: () => ({ enabled: true }) };
  if (state === "hidden") h.view.setVisible(false); else h.view.setInputEnabled(false);
  h.view.keyboardStateChanged(true); h.view.keyboardStateChanged(false); h.view.submitInput();
  expect(h.onInputEdit).not.toHaveBeenCalled();
  expect(h.onInputSubmit).not.toHaveBeenCalled();
});
