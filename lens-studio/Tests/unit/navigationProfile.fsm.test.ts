import { describe, expect, it } from "vitest";
import {
  deriveNavigationProfile,
  goalCommitAllowed,
  navigationGoalPolicy,
  navigationMarkerTransition,
  nextNavigationGoalMode,
  shouldSendGoalOnDragThreshold,
} from "../../Assets/Scripts/Navigation/NavigationProfile";

describe("deriveNavigationProfile", () => {
  it("maps manual operating mode to single and continuous profiles", () => {
    expect(deriveNavigationProfile("manual", "single")).toBe("manualSingle");
    expect(deriveNavigationProfile("manual", "continuous")).toBe("manualContinuous");
  });

  it("returns agentSingle stub for agent mode", () => {
    expect(deriveNavigationProfile("agent", "continuous")).toBe("agentSingle");
  });
});

describe("nextNavigationGoalMode", () => {
  it("cycles single and continuous", () => {
    expect(nextNavigationGoalMode("single")).toBe("continuous");
    expect(nextNavigationGoalMode("continuous")).toBe("single");
  });
});

describe("navigationMarkerTransition manualSingle", () => {
  it("idle drag enters preview", () => {
    expect(
      navigationMarkerTransition("manualSingle", "idle", { kind: "dragThresholdCrossed" }),
    ).toBe("preview");
  });

  it("preview confirm enters navigating", () => {
    expect(
      navigationMarkerTransition("manualSingle", "preview", { kind: "confirmPressed" }),
    ).toBe("navigating");
  });

  it("cancel from preview enters outcomeReset then idle", () => {
    expect(
      navigationMarkerTransition("manualSingle", "preview", { kind: "cancelPressed" }),
    ).toBe("outcomeReset");
    expect(
      navigationMarkerTransition("manualSingle", "outcomeReset", {
        kind: "outcomeResetComplete",
      }),
    ).toBe("idle");
  });
});

describe("navigationMarkerTransition manualContinuous", () => {
  it("idle drag skips preview and enters navigating", () => {
    expect(
      navigationMarkerTransition("manualContinuous", "idle", {
        kind: "dragThresholdCrossed",
      }),
    ).toBe("navigating");
  });

  it("goal reached returns to idle and respawns at robot", () => {
    expect(
      navigationMarkerTransition("manualContinuous", "navigating", { kind: "goalReached" }),
    ).toBe("idle");
  });
});

describe("navigationMarkerTransition profileChanged", () => {
  it("drops preview to idle when switching away from single preview phase", () => {
    expect(
      navigationMarkerTransition("manualContinuous", "preview", { kind: "profileChanged" }),
    ).toBe("idle");
  });

  it("keeps navigating phase on profile change", () => {
    expect(
      navigationMarkerTransition("manualContinuous", "navigating", { kind: "profileChanged" }),
    ).toBe("navigating");
  });
});

describe("navigationGoalPolicy", () => {
  it("requests preview paths in single preview phase", () => {
    expect(navigationGoalPolicy("manualSingle", "preview")).toBe("preview");
  });

  it("commits once in single navigating phase", () => {
    expect(navigationGoalPolicy("manualSingle", "navigating")).toBe("commit");
  });

  it("redispatches in continuous navigating phase", () => {
    expect(navigationGoalPolicy("manualContinuous", "navigating")).toBe("redispatch");
  });
});

describe("goalCommitAllowed", () => {
  it("allows confirm commit only in single navigating phase", () => {
    expect(goalCommitAllowed("manualSingle", "navigating", "confirm")).toBe(true);
    expect(goalCommitAllowed("manualSingle", "preview", "confirm")).toBe(false);
    expect(goalCommitAllowed("manualContinuous", "navigating", "confirm")).toBe(false);
  });

  it("allows stream commit in continuous navigating phase", () => {
    expect(goalCommitAllowed("manualContinuous", "navigating", "stream")).toBe(true);
    expect(goalCommitAllowed("manualSingle", "navigating", "stream")).toBe(false);
  });

  it("allows agent commit for agent profiles", () => {
    expect(goalCommitAllowed("agentSingle", "hidden", "agent")).toBe(true);
    expect(goalCommitAllowed("manualSingle", "navigating", "agent")).toBe(false);
  });
});

describe("shouldSendGoalOnDragThreshold", () => {
  it("streams on first drag threshold in continuous navigating", () => {
    expect(shouldSendGoalOnDragThreshold("manualContinuous", "navigating")).toBe(true);
    expect(shouldSendGoalOnDragThreshold("manualSingle", "navigating")).toBe(false);
  });
});
