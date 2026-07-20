import { describe, expect, it } from "vitest";
import {
  applyNavigationEvent,
  createInitialNavigationSession,
  resolveRetryableNavIntent,
  shouldSkipStaleLocalRecovery,
  type NavigationSession,
} from "../../Assets/Scripts/ARBridge/Navigation/NavigationModel";

function activeSession(goal: NavigationSession["goal"] = null): NavigationSession {
  return {
    ...createInitialNavigationSession(),
    navSessionActive: true,
    goal,
  };
}

describe("NavigationController lifecycle decisions", () => {
  describe("resolveRetryableNavIntent", () => {
    it("holds navigating when wire state is navigating", () => {
      expect(
        resolveRetryableNavIntent(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navigating" },
          false,
        ),
      ).toBe("holdNavigating");
    });

    it("holds nav intent when terminal status is suppressed", () => {
      expect(
        resolveRetryableNavIntent(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navigating" },
          true,
        ),
      ).toBe("holdNavIntent");
    });

    it("clears goal when wire is not navigating", () => {
      expect(
        resolveRetryableNavIntent(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navIntent" },
          false,
        ),
      ).toBe("clearGoal");
    });

    it("clears goal when no tracked goal context", () => {
      expect(
        resolveRetryableNavIntent(activeSession(), false),
      ).toBe("clearGoal");
    });
  });

  describe("shouldSkipStaleLocalRecovery", () => {
    it("skips recover_local while navigating with path evidence", () => {
      expect(
        shouldSkipStaleLocalRecovery(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navigating" },
          4,
        ),
      ).toBe(true);
    });

    it("does not skip recover_local without path evidence", () => {
      expect(
        shouldSkipStaleLocalRecovery(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navigating" },
          1,
        ),
      ).toBe(false);
    });

    it("does not skip recover_local when wire is not navigating", () => {
      expect(
        shouldSkipStaleLocalRecovery(
          { ...activeSession({ since: 0, source: "user" }), wireState: "navIntent" },
          4,
        ),
      ).toBe(false);
    });
  });

  describe("navStatus wire updates", () => {
    it("navStatus navigating keeps committed goal", () => {
      const initial = activeSession({ since: 0, source: "user" });
      const result = applyNavigationEvent(
        initial,
        { kind: "navStatus", state: "navigating" },
        1,
      );
      expect(result.state.goal).toEqual({ since: 0, source: "user" });
      expect(result.state.wireState).toBe("navigating");
      expect(result.wireEffects).toEqual([]);
    });
  });

  describe("drag takeover", () => {
    it("commitGoal during agent navigation emits sendNavGoal only", () => {
      const session: NavigationSession = {
        ...activeSession({
          since: 0,
          source: "agent",
          position: [1, 0, 2],
          orientation: [0, 0, 0, 1],
        }),
        wireState: "navigating",
      };
      const pose = {
        position: new vec3(3, 0, 4),
        rotation: quat.quatIdentity(),
      };
      const result = applyNavigationEvent(
        session,
        { kind: "commitGoal", sendToBridge: true, pose },
        2,
      );
      expect(result.state.goal?.source).toBe("user");
      expect(result.state.goal?.position).toEqual([1, 0, 2]);
      expect(result.wireEffects.map((e) => e.kind)).toEqual(["sendNavGoal"]);
      expect(result.wireEffects.some((e) => e.kind === "sendCancelGoal")).toBe(
        false,
      );
    });
  });
});
