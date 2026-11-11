import { expect, it } from "vitest";
import { matchesStopCommand } from "../../../Assets/Scripts/DimOSARClient/agent/AgentSpeechSession";
it("matches an explicit stop command on word boundaries", () => {
  expect(matchesStopCommand("please stop now")).toBe(true);
  expect(matchesStopCommand("stopwatch")).toBe(false);
});
