export const MODULE_HOST_STORAGE_KEY = "dimos_ar_module_host";

export function normalizeHost(raw: string): string {
  let host = raw.trim();
  if (host.startsWith("http://")) {
    host = host.substring(7);
  }
  if (host.startsWith("https://")) {
    host = host.substring(8);
  }
  if (host.startsWith("ws://")) {
    host = host.substring(5);
  }
  if (host.startsWith("wss://")) {
    host = host.substring(6);
  }
  while (host.endsWith("/")) {
    host = host.substring(0, host.length - 1);
  }
  const colonIdx = host.lastIndexOf(":");
  if (colonIdx > 0) {
    host = host.substring(0, colonIdx);
  }
  return host;
}

export function buildModuleWebSocketUrl(host: string, port: number): string {
  return `ws://${normalizeHost(host)}:${port}`;
}

export function isValidHost(raw: string): boolean {
  const host = normalizeHost(raw);
  if (!host) {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(host)) {
    return host.split(".").every((part) => {
      const n = Number(part);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }
  return /^[a-zA-Z0-9.-]+$/.test(host);
}

export interface ModuleHostStore {
  has(key: string): boolean;
  getString(key: string): string;
  putString(key: string, value: string): void;
  remove(key: string): void;
}

export function loadStoredModuleHost(store: ModuleHostStore): string | null {
  if (!store.has(MODULE_HOST_STORAGE_KEY)) {
    return null;
  }
  return store.getString(MODULE_HOST_STORAGE_KEY);
}

export function saveModuleHost(store: ModuleHostStore, rawHost: string): void {
  store.putString(MODULE_HOST_STORAGE_KEY, rawHost);
}

export function clearModuleHost(store: ModuleHostStore): void {
  if (store.has(MODULE_HOST_STORAGE_KEY)) {
    store.remove(MODULE_HOST_STORAGE_KEY);
  }
}
