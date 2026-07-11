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
          { ...activeSession({ since: 0 }), wireState: "navigating" },
          false,
        ),
      ).toBe("holdNavigating");
    });

    it("holds nav intent when terminal status is suppressed", () => {
      expect(
        resolveRetryableNavIntent(
          { ...activeSession({ since: 0 }), wireState: "navigating" },
          true,
        ),
      ).toBe("holdNavIntent");
    });

    it("clears goal when wire is not navigating", () => {
      expect(
        resolveRetryableNavIntent(
          { ...activeSession({ since: 0 }), wireState: "navIntent" },
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
          { ...activeSession({ since: 0 }), wireState: "navigating" },
          4,
        ),
      ).toBe(true);
    });

    it("does not skip recover_local without path evidence", () => {
      expect(
        shouldSkipStaleLocalRecovery(
          { ...activeSession({ since: 0 }), wireState: "navigating" },
          1,
        ),
      ).toBe(false);
    });

    it("does not skip recover_local when wire is not navigating", () => {
      expect(
        shouldSkipStaleLocalRecovery(
          { ...activeSession({ since: 0 }), wireState: "navIntent" },
          4,
        ),
      ).toBe(false);
    });
  });

  describe("navStatus wire updates", () => {
    it("navStatus navigating keeps committed goal", () => {
      const initial = activeSession({ since: 0 });
      const result = applyNavigationEvent(
        initial,
        { kind: "navStatus", state: "navigating" },
        1,
      );
      expect(result.state.goal).toEqual({ since: 0 });
      expect(result.state.wireState).toBe("navigating");
      expect(result.wireEffects).toEqual([]);
    });
  });
});
