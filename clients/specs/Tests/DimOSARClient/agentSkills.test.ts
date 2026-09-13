import { describe, expect, it } from "vitest";
import {
  composePlaceArMarker,
  parsePlaceArMarkerArgs,
  parseRemoveArMarkerArgs,
} from "../../Assets/Scripts/DimOSARClient/agent/agentSkills";
import type { ClientTrackingOrigin } from "../../Assets/Scripts/DimOSARClient/localization/clientTrackingOrigin";

const ORIGIN: ClientTrackingOrigin = {
  position: [1, 0, 0],
  orientation: [0, 0, 0, 1],
  confidence: 1,
  ts: 1,
};

describe("parsePlaceArMarkerArgs", () => {
  it("accepts an id, odom point, and optional title", () => {
    expect(
      parsePlaceArMarkerArgs({ id: " kitchen ", x: 2, y: 0, z: 0, title: "Kitchen" }),
    ).toEqual({
      id: "kitchen",
      x: 2,
      y: 0,
      z: 0,
      title: "Kitchen",
    });
    expect(parsePlaceArMarkerArgs({ id: "kitchen", x: 2, y: 0, z: 0 })).toEqual({
      id: "kitchen",
      x: 2,
      y: 0,
      z: 0,
      title: "",
    });
  });

  it("rejects blank or long ids, non-finite coordinates, and a non-string title", () => {
    expect(() => parsePlaceArMarkerArgs({ id: "  ", x: 1, y: 0, z: 0 })).toThrow(
      /ar_place_marker.id is blank/,
    );
    expect(() => parsePlaceArMarkerArgs({ id: "x".repeat(65), x: 1, y: 0, z: 0 })).toThrow(
      /ar_place_marker.id is too long/,
    );
    expect(() => parsePlaceArMarkerArgs({ id: "kitchen", x: 1, y: 0 })).toThrow(/ar_place_marker.z/);
    expect(() => parsePlaceArMarkerArgs({ id: "kitchen", x: Number.NaN, y: 0, z: 0 })).toThrow(
      /ar_place_marker.x/,
    );
    expect(() => parsePlaceArMarkerArgs({ id: "kitchen", x: 1, y: 0, z: 0, title: 1 })).toThrow(
      /title/,
    );
  });
});

describe("parseRemoveArMarkerArgs", () => {
  it("requires a trimmed id", () => {
    expect(parseRemoveArMarkerArgs({ id: " door " })).toEqual({ id: "door" });
    expect(() => parseRemoveArMarkerArgs({})).toThrow(/ar_remove_marker.id is blank/);
  });
});

describe("composePlaceArMarker", () => {
  it("composes the odom point through T_odom_client", () => {
    const composed = composePlaceArMarker(
      parsePlaceArMarkerArgs({ id: "kitchen", x: 2, y: 0, z: 0 }),
      ORIGIN,
    );
    expect(composed.position).toEqual([1, 0, 0]);
    expect(composed.title).toBe("");
  });
});
