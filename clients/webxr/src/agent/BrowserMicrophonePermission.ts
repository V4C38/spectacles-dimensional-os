export type MicrophonePermission = "needed" | "requesting" | "granted" | "unsupported";

/** Checks microphone access without keeping a stream or starting dictation. */
export class BrowserMicrophonePermission {
  state: MicrophonePermission;
  error: string | null = null;
  private generation = 0;

  constructor(private readonly onChange: () => void) {
    this.state = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
      ? "needed" : "unsupported";
  }

  check(): void {
    if (this.state === "unsupported" || this.state === "requesting") return;
    const generation = ++this.generation;
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then(permission => {
      if (generation !== this.generation) return;
      this.state = permission.state === "granted" ? "granted" : "needed";
      if (this.state === "granted") this.error = null;
      this.onChange();
    }, () => {
      // Some headset browsers support capture without exposing the permission query.
    });
  }

  request(): void {
    if (this.state !== "needed") return;
    const generation = ++this.generation;
    this.state = "requesting";
    this.error = null;
    this.onChange();
    // Call inside the user's input event, before any permission or XR await.
    void navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
      for (const track of stream.getTracks()) track.stop();
      if (generation !== this.generation) return;
      this.state = "granted";
      this.onChange();
    }, error => {
      if (generation !== this.generation) return;
      this.state = "needed";
      this.error = error instanceof Error && (error.name === "NotAllowedError" || error.name === "SecurityError")
        ? "Allow microphone access in browser and headset settings, then try again."
        : error instanceof Error && error.name === "NotFoundError"
          ? "No microphone found."
          : "Could not open the microphone. Try again.";
      this.onChange();
    });
  }
}
