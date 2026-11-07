import { SpecsWebSocketTransport } from "../../../../specs/Assets/Scripts/DimOSSpecsClient/websocket/SpecsWebSocketTransport";

/** Browser ports emulate the native SDK boundary, never Specs transport behavior. */
export function specsTransport(url: string): SpecsWebSocketTransport {
  const script = {
    createEvent() {
      let callback = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
      return { bind(fn: () => void) { callback = fn; }, reset(seconds: number) { clearTimeout(timer); timer = setTimeout(callback, seconds * 1000); }, cancel() { clearTimeout(timer); } };
    },
    removeEvent(event: { cancel(): void }) { event.cancel(); },
  };
  return new SpecsWebSocketTransport({ url, script, internetModule: { createWebSocket: (endpoint: string) => new WebSocket(endpoint) } } as unknown as ConstructorParameters<typeof SpecsWebSocketTransport>[0]);
}
