import { describe, expect, it } from "vitest";
import {
  buildModuleWebSocketUrl,
  isValidHost,
  normalizeHost,
} from "../../../Assets/Scripts/DimOSARClient/websocket/hostNormalization";

describe("normalizeHost", () => {
  it("strips scheme, path, and port", () => {
    expect(normalizeHost("  ws://192.168.1.108:8787/  ")).toBe("192.168.1.108");
    expect(normalizeHost("https://robot.local:8787")).toBe("robot.local");
    expect(normalizeHost("192.168.1.108")).toBe("192.168.1.108");
  });
});

describe("buildModuleWebSocketUrl", () => {
  it("builds ws url with normalized host", () => {
    expect(buildModuleWebSocketUrl("ws://192.168.1.108:9999", 8787)).toBe(
      "ws://192.168.1.108:8787",
    );
  });
});

describe("isValidHost", () => {
  it("accepts ipv4 and hostnames", () => {
    expect(isValidHost("192.168.1.108")).toBe(true);
    expect(isValidHost("localhost")).toBe(true);
    expect(isValidHost("robot.local")).toBe(true);
  });

  it("rejects empty and invalid ipv4", () => {
    expect(isValidHost("")).toBe(false);
    expect(isValidHost("999.999.999.999")).toBe(false);
  });
});
