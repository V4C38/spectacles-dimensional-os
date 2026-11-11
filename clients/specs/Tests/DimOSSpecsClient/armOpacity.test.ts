import { expect, it, vi } from "vitest";
import { armDisplacementCoefficients, ArmOpacityUniforms } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ArmMaterial";
import { armPointDisplacement, ArmMeshFade, ArmOpacityCadence } from "../../Assets/Scripts/DimOSARClient/manipulation/ManipulationVisuals";
import { clientTrackingToSpecsPoint } from "../../Assets/Scripts/DimOSSpecsClient/utilities/SpecsCoordinates";
import type { ManipulationPose } from "../../Assets/Scripts/DimOSARClient/manipulation/ManipulationTypes";

const identity: ManipulationPose = { position: [0, 0, 0], orientation: [0, 0, 0, 1] };

/** The scalar arithmetic used by both arm vertex shaders, before interpolation. */
function shaderOpacity(pass: Record<string, number>, local: readonly number[]): number {
  const delta = [0, 1, 2].map(row => local.reduce((sum, value, column) =>
    sum + value * pass[`pointDelta${row}${column}`], pass[`pointDelta${"XYZ"[row]}`]));
  const t = Math.max(0, Math.min(1, (Math.hypot(...delta) - 0.5) / 9.5));
  return pass.pointVisibility * (pass.pointFloor + Math.max(0, t * t * (3 - 2 * t) - pass.pointFloor) * pass.pointBoost);
}

it("preserves surface and outline endpoint opacity in the Specs basis, including root rotation", () => {
  const measured: ManipulationPose = { position: [0.2, -0.1, 0.4], orientation: [0, 0, Math.sin(0.2), Math.cos(0.2)] };
  const proposed: ManipulationPose[] = [identity, measured,
    { ...measured, position: [0.203, -0.1, 0.4] },
    { ...measured, position: [0.24, -0.12, 0.4] },
    { ...measured, orientation: [0, Math.sin(0.35), 0, Math.cos(0.35)] }];
  for (const next of proposed) for (const floor of [0, 0.25]) for (const boost of [1, 1.1]) {
    const coefficients = armDisplacementCoefficients(measured, next);
    const pass = Object.fromEntries(coefficients.map((value, i) =>
      [i < 9 ? `pointDelta${Math.floor(i / 3)}${i % 3}` : `pointDelta${"XYZ"[i - 9]}`, value]));
    Object.assign(pass, { pointFloor: floor, pointBoost: boost, pointVisibility: 1 });
    const weight = armPointDisplacement(measured, next);
    for (const local of [[0, 0, 0], [0.02, -0.03, 0.1], [-0.2, 0.1, 0.05]] as [number, number, number][]) {
      for (const point of [local, [-local[1], local[0], local[2]] as [number, number, number]]) {
        expect(shaderOpacity(pass, clientTrackingToSpecsPoint(point))).toBeCloseTo(floor + Math.max(0, weight(...point) - floor) * boost, 11);
      }
    }
    pass.pointVisibility = 0;
    expect(shaderOpacity(pass, [0, 0, 0])).toBe(0);
  }
});

it("samples displacement on request, smoothly fades and stops writing settled uniforms", () => {
  const opacity = new ArmOpacityUniforms(), writes = vi.fn();
  const pass: Record<string, number> = {};
  const material = { mainPass: new Proxy(pass, { set(target, key, value) {
    writes(key, value); target[String(key)] = value; return true;
  } }) } as unknown as Material;
  const style = { pointVisible: true, floor: 0.25, displacementBoost: 1 };
  opacity.sample(identity, identity, style, true, 1 / 60); opacity.apply(material);
  const first = shaderOpacity(pass, [0, 0, 0]);
  expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(0.25);
  const displaced: ManipulationPose = { ...identity, position: [0.1, 0, 0] };
  opacity.sample(identity, displaced, style, false, 1 / 60); opacity.apply(material);
  expect(pass.pointDeltaZ).toBe(0);
  opacity.sample(identity, displaced, style, true, 1 / 60); opacity.apply(material);
  expect(pass.pointDeltaZ).toBeGreaterThan(0); expect(pass.pointDeltaZ).toBeLessThan(10);
  for (let frame = 0; frame < 180; frame++) {
    opacity.sample(identity, displaced, style, false, 1 / 60); opacity.apply(material);
  }
  expect(shaderOpacity(pass, [0, 0, 0])).toBeCloseTo(1, 6);
  writes.mockClear();
  for (let frame = 0; frame < 60; frame++) {
    opacity.sample(identity, displaced, style, false, 1 / 60); opacity.apply(material);
  }
  expect(writes).not.toHaveBeenCalled();
  opacity.sample(identity, displaced, { ...style, pointVisible: false }, false, 1 / 60); opacity.apply(material);
  expect(shaderOpacity(pass, [0, 0, 0])).toBeGreaterThan(0);
  for (let frame = 0; frame < 180; frame++) {
    opacity.sample(identity, displaced, { ...style, pointVisible: false }, false, 1 / 60); opacity.apply(material);
  }
  expect(shaderOpacity(pass, [0, 0, 0])).toBe(0);
});

vi.mock("SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider", () => ({ Slider: class {} }));
vi.mock("../mocks/UIKit.ts", () => ({ setButtonStyle: vi.fn(), SnapOS2Styles: {} }));
import { ManipulationRenderer } from "../../Assets/Scripts/DimOSSpecsClient/manipulation/ManipulationRenderer";
import { ArmPresentationSampler } from "../../Assets/Scripts/DimOSARClient/manipulation/ArmPresentationSampler";
import { ManipulationPreviewPlayback } from "../../Assets/Scripts/DimOSARClient/manipulation/ManipulationPresentation";
import { ArmTrajectoryProgress } from "../../Assets/Scripts/DimOSARClient/manipulation/ArmTrajectoryProgress";
import { PanelHeightAnimation } from "../../Assets/Scripts/DimOSARClient/presentation/PanelHeightAnimation";
import { ARM_FIXTURE } from "../integration-tests/IntegrationArmFixture";

it("keeps all initialized link buffers static during reveal, motion, warnings and hiding", () => {
  const node = (): any => ({ enabled: true, getComponent: () => ({}), getTransform: () => ({
    setWorldPosition: vi.fn(), setWorldRotation: vi.fn(), setLocalPosition: vi.fn(),
    getWorldPosition: () => vec3.zero(), getWorldRotation: () => quat.quatIdentity(),
  }) });
  const visual = (): any => ({ object: node(), material: { mainPass: {} },
    triangles: vi.fn(), segments: vi.fn(), style: vi.fn(), pose: vi.fn(), setColor: vi.fn(), hide: vi.fn() });
  const button = (): any => ({ sceneObject: node(), button: {}, labelText: {} });
  const intent = { fresh: true, canManipulate: true, dragging: false, finishing: false,
    targetOffset: false, executing: false, resetting: false, activity: "Ready" };
  const interaction = { snapshot: () => intent, groupId: "arm", rejection: null as object | null,
    target: null, plan: null, previewJoints: null as Record<string, number> | null, speedScale: 0.5 };
  const links = ARM_FIXTURE.model.links.map(link => link.name);
  const meshes = new Map(links.map(name => [name, visual()]));
  const edges = new Map(links.map(name => [name, { stroke: visual() }]));
  const renderer = Object.assign(Object.create(ManipulationRenderer.prototype), {
    core: { interaction, presentation: new ManipulationPreviewPlayback() }, object: node(),
    meshes, edges, picks: new Map(), placements: new Map(),
    pointOpacity: new Map(links.map(name => [name, new ArmOpacityUniforms()])),
    hoverSources: new Set(), handleHover: new Set(), actionHover: new Set(),
    modelRevision: ARM_FIXTURE.model.revision, context: "", debugNodes: new Map(),
    sampler: new ArmPresentationSampler(),
    meshFade: new ArmMeshFade(), fillFade: new ArmMeshFade(), opacityCadence: new ArmOpacityCadence(),
    progress: new ArmTrajectoryProgress(), menuHeight: new PanelHeightAnimation(),
    controls: { panelPresenter: { update: vi.fn() }, gripper: button(), previewMenu: node(), rescan: button(),
      panelTitle: {}, speedLabel: {}, speed: { currentValue: 0, getSceneObject: node },
      buttons: new Map(["reset", "stop", "estop"].map(key => [key, button()])), scanIcon: null },
    handle: node(), measured: visual(), base: node(), nameLabel: {}, activityLabel: {}, label: {}, sphere: visual(),
    warning: { apply: vi.fn() }, path: visual(), pathPoints: [], pathDistances: [],
    correction: { update: vi.fn(), reset: vi.fn() },
    lastTime: 0, solutionSequence: 0, uploadedPath: "", menuRows: "", scanIcon: null,
  }) as ManipulationRenderer;
  const state: any = { available: true, model: ARM_FIXTURE.model, root_pose: identity,
    groups: [{ id: "arm", joint_names: Object.keys(ARM_FIXTURE.joints), has_gripper: true }],
    observations: { arm: { joints: ARM_FIXTURE.joints, gripper: 0 } } };
  const origin: any = { ...identity, confidence: 1, ts: 0 };
  for (let frame = 1; frame < 360; frame++) {
    interaction.previewJoints = frame > 60 && frame < 180 ? { ...ARM_FIXTURE.joints, yam_joint2: 1.3 } : null;
    interaction.rejection = frame > 180 && frame < 240 ? { failedJoints: ["yam_joint2"] } : null;
    (renderer as any).hoverSources = new Set(frame > 240 ? ["hand"] : []);
    renderer.apply(state, origin, frame <= 240, true, frame / 60, node(), "OpenYAM");
  }
  for (const mesh of meshes.values()) {
    expect(mesh.triangles).not.toHaveBeenCalled();
    // Hover-only reveals the outline; zero-opacity fill meshes are disabled.
    expect(mesh.object.enabled).toBe(false);
  }
  for (const edge of edges.values()) {
    expect(edge.stroke.segments).not.toHaveBeenCalled();
    expect(edge.stroke.object.enabled).toBe(true);
    expect(edge.stroke.style).toHaveBeenCalled();
  }
  // EOF keeps historical observations visible while commands remain disabled.
  state.read_only = true; state.observations.arm.measured_at = 1;
  intent.fresh = false; intent.canManipulate = false; intent.activity = "Recording";
  for (let frame = 360; frame < 420; frame++) renderer.apply(state, origin, true, true, frame / 60, node(), "OpenYAM");
  expect((renderer as any).object.enabled).toBe(true);
  expect((renderer as any).activityLabel.text).toBe("Recording");
  for (const mesh of meshes.values()) {
    expect(mesh.object.enabled).toBe(true); expect(mesh.triangles).not.toHaveBeenCalled();
  }
  expect((renderer as any).controls.speed.enabled).toBe(false);
  for (const button of (renderer as any).controls.buttons.values()) expect(button.button.inactive).toBe(true);
});
