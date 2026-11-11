import { expect, it } from "vitest";
import { MarkerCorrectionTrail } from "../../Assets/Scripts/DimOSARClient/presentation/MarkerCorrectionTrail";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";

const origin: ClientTrackingOrigin = { position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 };
const correction: ClientTrackingOrigin = { ...origin, position: [1, 0, 0] };

it("starts only on a changed alignment and catches a moving destination in half a second", () => {
  const trail = new MarkerCorrectionTrail();
  expect(trail.update(origin, [0, 1, 0], 0)).toBeNull();
  expect(trail.update(origin, [1, 1, 0], 1)).toBeNull();
  expect(trail.update({ ...origin, ts: 2, confidence: 0.8 }, [2, 1, 0], 2)).toBeNull();
  expect(trail.update(correction, [4, 1, 0], 3)).toEqual([2, 1, 0]);
  expect(trail.update(correction, [6, 1, 0], 3.25)).toEqual([2, 1, 0]);
  expect(trail.displayedPosition).toEqual([4, 1, 0]);
  expect(trail.update(correction, [8, 1, 0], 3.5)).toEqual([2, 1, 0]);
  expect(trail.displayedPosition).toEqual([8, 1, 0]);
  trail.update(correction, [8, 1, 0], 3.55);
  expect(trail.scale).toBeCloseTo(0.5);
  expect(trail.update(correction, [10, 1, 0], 4)).toBeNull();
});

it("restarts from the real marker's previous position on another correction", () => {
  const trail = new MarkerCorrectionTrail();
  trail.update(origin, [0, 0, 0], 0);
  trail.update(correction, [2, 0, 0], 1);
  trail.update(correction, [3, 0, 0], 1.1);
  expect(trail.update({ ...origin, position: [2, 0, 0] }, [5, 0, 0], 1.2)![0]).toBeCloseTo(0.6);
});

it("ignores equivalent quaternion signs and animates actual rotation corrections", () => {
  const trail = new MarkerCorrectionTrail();
  trail.update(origin, [1, 0, 0], 0);
  expect(trail.update({ ...origin, orientation: [0, 0, 0, -1] }, [1, 0, 0], 1)).toBeNull();
  expect(trail.update({ ...origin, orientation: [0, 0, 1, 0] }, [-1, 0, 0], 2)).toEqual([1, 0, 0]);
});

it("clears the copy when hidden and treats the next alignment as the first", () => {
  const trail = new MarkerCorrectionTrail();
  trail.update(origin, [0, 0, 0], 0);
  trail.update(correction, [1, 0, 0], 1);
  expect(trail.update(null, [1, 0, 0], 1.1)).toBeNull();
  expect(trail.update(correction, [2, 0, 0], 2)).toBeNull();
  trail.reset();
  expect(trail.update(origin, [0, 0, 0], 3)).toBeNull();
});

it("does not trail across map or tracking reference changes", () => {
  const trail = new MarkerCorrectionTrail();
  const aligned = { ...origin, mapAlignment: { map_code: "map", odom_reference_id: "odom", tracking_reference_id: "a",
    position: [0, 0, 0], orientation: [0, 0, 0, 1], confidence: 1, ts: 0 } } as ClientTrackingOrigin;
  trail.update(aligned, [0, 0, 0], 0);
  expect(trail.update({ ...correction, mapAlignment: { ...aligned.mapAlignment!, tracking_reference_id: "b" } }, [2, 0, 0], 1)).toBeNull();
});
