// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { ARModuleSession, ARModuleSessionState } from "@dimos-ar-client/websocket/arModuleSession";
import { LandingInfoPresenter } from "../src/presentation/LandingInfoPresenter";

it("uses the shared hello and clears stale server details on disconnect without guessing addresses", () => {
  const root = document.createElement("aside");
  for (const key of ["server", "build", "robot", "robot-ip", "dimos", "armodule", "status", "features"]) { const value = document.createElement("span"); value.dataset.info = key; root.append(value); }
  const navigation = document.createElement("li"); navigation.dataset.feature = "navigation"; root.append(navigation);
  const agent = document.createElement("li"); agent.dataset.feature = "agent"; root.append(agent);
  const presenter = new LandingInfoPresenter(root, "192.168.1.2:5173");
  let listener: (view: ARModuleSessionState) => void = () => {};
  const session = { view: () => ({ connection: "disconnected" }), subscribeView: (callback: typeof listener) => { listener = callback; return () => {}; } } as unknown as ARModuleSession;
  presenter.bind(session);
  const get = (key: string) => root.querySelector(`[data-info="${key}"]`)!.textContent;
  expect(get("server")).toBe("192.168.1.2:5173"); expect(get("robot-ip")).toBe("Unavailable");
  listener({ connection: "ready", hello: { robot: { display_name: "Unitree Go2" }, capabilities: { navigation: { available: true }, agent: { available: false } }, server_info: { robot_ip: "10.0.0.42", dimos_version: "0.4.0" } } } as unknown as ARModuleSessionState);
  expect(navigation.hidden).toBe(false); expect(agent.hidden).toBe(true); expect(get("features")).toBe("");
  expect(get("robot-ip")).toBe("10.0.0.42"); expect(get("robot")).toBe("Unitree Go2"); expect(get("armodule")).toBe("Unavailable");
  listener({ connection: "failed" } as ARModuleSessionState);
  expect(navigation.hidden).toBe(true); expect(get("features")).toBe("Waiting for robot…");
  expect(get("robot-ip")).toBe("Unavailable"); expect(get("status")).toBe("Reconnecting…"); presenter.dispose();
});
