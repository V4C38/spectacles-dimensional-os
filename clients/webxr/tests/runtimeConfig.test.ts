import { describe, expect, it } from "vitest";
import { arModuleSameOriginUrl } from "../src/runtimeConfig";

describe("arModuleSameOriginUrl", () => {
  it("derives same-origin wss:///ar from an HTTPS page", () => {
    expect(arModuleSameOriginUrl({ protocol: "https:", host: "192.168.1.8:5173" })).toBe(
      "wss://192.168.1.8:5173/ar",
    );
  });

  it("rejects non-HTTPS page origins", () => {
    expect(() => arModuleSameOriginUrl({ protocol: "http:", host: "127.0.0.1:5173" })).toThrow("HTTPS");
    expect(() => arModuleSameOriginUrl({ protocol: "file:", host: "" })).toThrow("http or https");
  });
});
