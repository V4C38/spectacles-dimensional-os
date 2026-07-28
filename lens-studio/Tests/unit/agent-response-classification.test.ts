import { describe, it, expect } from "vitest";
import { classifyAgentResponseText } from "../../Assets/Scripts/App/Agent/AgentResponseClassification";

describe("classifyAgentResponseText", () => {
  it("returns ok for success-style replies", () => {
    expect(classifyAgentResponseText("On my way")).toBe("ok");
    expect(classifyAgentResponseText("Annotation 'x' drawn")).toBe("ok");
  });

  it("classifies known bridge errors as error", () => {
    expect(classifyAgentResponseText("Robot is not connected")).toBe("error");
    expect(
      classifyAgentResponseText("Cannot move: World frame is not committed"),
    ).toBe("error");
    expect(classifyAgentResponseText("No odometry available yet")).toBe("error");
    expect(classifyAgentResponseText("No AR client connected")).toBe("error");
    expect(
      classifyAgentResponseText("AR skill timed out after 5.0s: draw_world_annotation"),
    ).toBe("error");
    expect(classifyAgentResponseText("camera transform unavailable")).toBe("error");
    expect(
      classifyAgentResponseText("command not sent (bridge not ready)"),
    ).toBe("error");
  });

  it("classifies annotation skill failures as error", () => {
    expect(classifyAgentResponseText("annotation id is required")).toBe("error");
    expect(
      classifyAgentResponseText("unsupported annotation kind: blob"),
    ).toBe("error");
    expect(classifyAgentResponseText("draw_world_annotation failed")).toBe("error");
  });

  it("classifies navigation cancelled as warn", () => {
    expect(classifyAgentResponseText("Navigation cancelled")).toBe("warn");
  });

  it("returns ok for empty text", () => {
    expect(classifyAgentResponseText("")).toBe("ok");
    expect(classifyAgentResponseText("   ")).toBe("ok");
  });
});
