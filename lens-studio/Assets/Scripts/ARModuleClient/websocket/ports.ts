export interface Transport {
  connect(): void;
  close(): void;
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
}

export interface Clock {
  now(): number;
}
