import { expect, it, vi } from "vitest";
import { RobotSelection, getRobotActivityState } from "../src/robot/RobotPresentation";

it("owns eligible selection and notifies only on transitions", () => {
  const selection = new RobotSelection(), changed = vi.fn();
  const unsubscribe = selection.subscribe(changed);
  selection.toggle(); expect(selection.isSelected()).toBe(false);
  selection.setEligible(true); selection.toggle(); selection.setSelected(true);
  expect(changed.mock.calls).toEqual([[true]]);
  selection.setEligible(false); expect(selection.isSelected()).toBe(false);
  selection.setEligible(true); expect(selection.isSelected()).toBe(false);
  unsubscribe(); selection.toggle(); expect(changed.mock.calls).toEqual([[true], [false]]);
});

it("prioritizes shared E-stop above navigation, agent, and voice activity and clears on resume", () => {
  const view = { nav: { state: "following_path", outcome: null },
    state: { agent: { idle: false }, safety: { stopped: true, can_resume: true } } };
  const voice = { ttsPlaying: true, asrRunning: true };
  expect(getRobotActivityState(view as never, voice)).toBe("Stopped");
  view.state.safety.stopped = false;
  expect(getRobotActivityState(view as never, voice)).toBe("Following Path");
});
