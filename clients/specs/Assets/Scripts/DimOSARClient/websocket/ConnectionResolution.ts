/** Discovery runs only before a control socket opens; session owns retry cadence. */
export interface ResolvedConnection {
  controlUrl: string;
  bulkUrl?: string;
}
export type ConnectionResolver = () => Promise<ResolvedConnection>;
export type ConnectionTimer = (seconds: number, callback: () => void) => () => void;

export function validPin(value: string): boolean { return /^\d{6}$/.test(value); }

export class ConnectionResolution {
  private generation = 0;
  private resolver: ConnectionResolver | undefined;
  private cancelTimeout: (() => void) | null = null;

  constructor(private readonly schedule: ConnectionTimer) {}

  setResolver(resolver: ConnectionResolver | undefined): void {
    this.cancel(); this.resolver = resolver;
  }

  cancel(): void {
    this.generation++;
    this.cancelTimeout?.(); this.cancelTimeout = null;
  }

  run(open: (endpoint?: ResolvedConnection) => void, fail: () => void): void {
    this.cancel();
    if (!this.resolver) { open(); return; }
    const generation = this.generation;
    const finish = (endpoint?: ResolvedConnection) => {
      if (generation !== this.generation) return;
      this.cancel();
      if (endpoint) open(endpoint); else fail();
    };
    // Discovery has its own budget; existing socket/hello timeouts remain unchanged.
    this.cancelTimeout = this.schedule(15, () => finish());
    try { void this.resolver().then(endpoint => finish(endpoint), () => finish()); }
    catch { finish(); }
  }
}
