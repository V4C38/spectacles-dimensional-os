export function arModuleSameOriginUrl(location: { protocol: string; host: string }): string {
  if (location.protocol !== "https:" && location.protocol !== "http:") {
    throw new Error("WebXR page origin must be http or https");
  }
  if (location.protocol !== "https:") {
    throw new Error("Open this page over HTTPS. The headset WebSocket uses same-origin wss:///ar.");
  }
  if (!location.host) {
    throw new Error("page host is required");
  }
  return `wss://${location.host}/ar`;
}
