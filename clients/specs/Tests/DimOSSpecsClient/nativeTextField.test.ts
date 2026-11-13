import { afterEach, expect, it, vi } from "vitest";
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow", () => ({ ScrollWindow: { getTypeName: () => "window" } }));
vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: { getTypeName: () => "slider" } }));
const { createText } = vi.hoisted(() => ({ createText: vi.fn() }));
vi.mock("../mocks/UIKit.ts", () => ({ createText, configurePanelText: vi.fn(), COLOR_WHITE: {}, FONT_CAPTION: 12 }));
import { ScrollableTextView } from "../../Assets/Scripts/DimOSSpecsClient/presentation/ScrollableTextView";

afterEach(() => vi.unstubAllGlobals());

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    add: (listener: (value: T) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    emit: (value: T) => { for (const listener of listeners) listener(value); },
  };
}

function fixture() {
  class Vec2 { constructor(public x: number, public y: number) {} }
  vi.stubGlobal("vec2", Vec2);
  vi.stubGlobal("quat", { angleAxis: () => ({}) });
  vi.stubGlobal("HorizontalAlignment", { Left: "left" });
  vi.stubGlobal("VerticalAlignment", { Top: "top" });
  vi.stubGlobal("Rect", { create: (left: number, right: number, bottom: number, top: number) => ({ left, right, bottom, top }) });
  const positionUpdated = event<void>(), dimensionsUpdated = event<void>(), valueChanged = event<number>();
  let position = new Vec2(0, 1), dimensions = new Vec2(40, 20), sliderValue = 1;
  const windowWrites = vi.fn(), sliderWrites = vi.fn();
  const window = {
    windowSize: new Vec2(40, 20), initialize: vi.fn(), addObject: vi.fn(),
    onScrollPositionUpdated: positionUpdated, onScrollDimensionsUpdated: dimensionsUpdated,
    get scrollDimensions() { return dimensions; },
    set scrollDimensions(value: Vec2) { dimensions = value; dimensionsUpdated.emit(); },
    get scrollPositionNormalized() { return position; },
    set scrollPositionNormalized(value: Vec2) { windowWrites(value); position = value; positionUpdated.emit(); },
  };
  const slider = {
    onValueChange: valueChanged,
    get currentValue() { return sliderValue; },
    set currentValue(value: number) { sliderWrites(value); sliderValue = value; valueChanged.emit(value); },
  };
  const nodes = new Map<string, any>();
  const createNode = (name: string) => {
    const transform = { setLocalPosition: vi.fn(), setLocalRotation: vi.fn() };
    const node = { enabled: true, setParent: vi.fn(), getTransform: () => transform,
      getComponent: () => ({}), createComponent: (type: string) => type === "window" ? window : slider, destroy: vi.fn() };
    nodes.set(name, node); return node;
  };
  vi.stubGlobal("global", { scene: { createSceneObject: createNode } });
  let measuredHeight = 8;
  const textNode = createNode("text");
  const text = { text: "", getBoundingBox: () => ({ getSize: () => ({ y: measuredHeight }) }), getSceneObject: () => textNode };
  vi.mocked(createText).mockReturnValue(text as any);
  const field = new ScrollableTextView({} as any, "Field", 40, 20, 3);
  windowWrites.mockClear(); sliderWrites.mockClear();
  return { field, text, window, slider, windowWrites, sliderWrites, nodes,
    measure: (height: number) => { measuredHeight = height; }, valueChanged, positionUpdated, dimensionsUpdated };
}

it("sizes short and wrapped content and chooses the requested scroll endpoint", () => {
  const h = fixture();
  h.field.setText("short");
  expect(h.text.text).toBe("short");
  expect(h.window.scrollDimensions.y).toBe(20);
  expect(h.nodes.get("FieldScrollBar").enabled).toBe(false);
  expect(h.window.scrollPositionNormalized.y).toBe(1);
  h.measure(65); h.field.setText("wrapped conversation", true);
  expect(h.window.scrollDimensions.y).toBe(65);
  expect(h.nodes.get("FieldScrollBar").enabled).toBe(true);
  expect(h.window.scrollPositionNormalized.y).toBe(-1);
  expect(h.slider.currentValue).toBe(0);
  h.field.setText("new diagnostics");
  expect(h.window.scrollPositionNormalized.y).toBe(1);
  expect(h.slider.currentValue).toBe(1);
  h.field.dispose();
});

it("round-trips public slider/window events without feedback and disposes once", () => {
  const h = fixture();
  h.slider.currentValue = 0.25;
  expect(h.window.scrollPositionNormalized.y).toBe(-0.5);
  expect(h.windowWrites).toHaveBeenCalledOnce();
  h.windowWrites.mockClear(); h.sliderWrites.mockClear();
  h.window.scrollPositionNormalized = { x: 0, y: 0.6 };
  expect(h.slider.currentValue).toBe(0.8);
  expect(h.windowWrites).toHaveBeenCalledOnce();
  expect(h.sliderWrites).toHaveBeenCalledOnce();
  h.field.dispose(); h.field.dispose();
  expect(h.nodes.get("Field").destroy).toHaveBeenCalledOnce();
  expect(h.nodes.get("FieldScrollBar").destroy).toHaveBeenCalledOnce();
  h.windowWrites.mockClear(); h.sliderWrites.mockClear();
  h.valueChanged.emit(0); h.positionUpdated.emit(); h.dimensionsUpdated.emit();
  h.field.setText("after disposal");
  expect(h.windowWrites).not.toHaveBeenCalled();
  expect(h.sliderWrites).not.toHaveBeenCalled();
  expect(h.text.text).toBe("");
});
