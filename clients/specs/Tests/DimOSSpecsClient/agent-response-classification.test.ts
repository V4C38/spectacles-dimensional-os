import { describe, it, expect } from "vitest";
import { classifyAgentResponseText } from "../../Assets/Scripts/DimOSSpecsClient/agent/AgentResponseClassification";

describe("classifyAgentResponseText", () => {
  it("returns ok for success-style replies", () => {
    expect(classifyAgentResponseText("On my way")).toBe("ok");
    expect(classifyAgentResponseText("Annotation 'x' drawn")).toBe("ok");
  });

  it("classifies known readiness errors as error", () => {
    expect(classifyAgentResponseText("No AR client connected")).toBe("error");
    expect(classifyAgentResponseText("No client pose")).toBe("error");
    expect(classifyAgentResponseText("unknown marker id")).toBe("error");
    expect(classifyAgentResponseText("id is blank")).toBe("error");
    expect(classifyAgentResponseText("id is too long")).toBe("error");
  });

  it("does not treat unrelated phrases as errors", () => {
    expect(classifyAgentResponseText("hello from the agent")).toBe("ok");
    expect(classifyAgentResponseText("Walking to the kitchen")).toBe("ok");
    expect(classifyAgentResponseText("ok")).toBe("ok");
  });

  it("classifies navigation cancelled as warn", () => {
    expect(classifyAgentResponseText("Navigation cancelled")).toBe("warn");
  });

  it("returns ok for empty text", () => {
    expect(classifyAgentResponseText("")).toBe("ok");
    expect(classifyAgentResponseText("   ")).toBe("ok");
  });
});
