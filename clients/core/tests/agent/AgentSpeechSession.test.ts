import { expect, it } from "vitest";
import { matchesStopCommand } from "../../src/agent/AgentSpeechSession";
it("matches an explicit stop command on word boundaries", () => {
  expect(matchesStopCommand("please stop now")).toBe(true);
  expect(matchesStopCommand("stopwatch")).toBe(false);
});
