import type { RecognitionPort, SynthesisPort } from "@dimos-ar-client/agent/AgentDraftSession";

// Host-only Web Speech API adapter. No browser APIs enter ClientCore.
interface BrowserRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
  stop(): void;
}

export interface BrowserDictation {
  available(): boolean;
  availabilityError?(): string | null;
  transcribe(data: Uint8Array, mimeType: string, progress?: (status: "preparing" | "transcribing") => void): { result: Promise<string>; cancel(): void };
}

/** Media capture is host-owned; Core only receives the correlated transcript. */
export function recordedRecognition(dictation: BrowserDictation): RecognitionPort | null {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let generation = 0;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let transcription: { cancel(): void } | null = null;
  let preparing = false;
  const release = () => {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };
  const stop = () => {
    generation++;
    transcription?.cancel(); transcription = null;
    if (recorder) {
      recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      recorder = null;
    }
    release();
  };
  return {
    finishTimeoutS: 245,
    transcriptionStatus: () => preparing ? "Preparing dictation…" : "Transcribing…",
    start(onText, onError, onEnd, onStarted) {
      stop();
      preparing = false;
      if (!dictation.available()) { onError(dictation.availabilityError?.() ?? "Local dictation is unavailable on this server"); return; }
      const epoch = generation;
      let bytes = 0;
      const chunks: Blob[] = [];
      const fail = (error: unknown) => {
        if (epoch !== generation) return;
        stop();
        const reason = error instanceof Error ? error.message : String(error);
        onError(/denied|permission|NotAllowed/i.test(reason)
          ? "Allow microphone access in browser permissions, then try again" : reason);
      };
      void navigator.mediaDevices.getUserMedia({ audio: true }).then(media => {
        if (epoch !== generation) { media.getTracks().forEach(track => track.stop()); return; }
        stream = media;
        const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
          .find(value => MediaRecorder.isTypeSupported(value));
        const active = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
        recorder = active;
        active.ondataavailable = event => {
          if (epoch !== generation || !event.data.size) return;
          bytes += event.data.size;
          if (bytes > 2097152) { fail(new Error("Recording is too large. Record a shorter message.")); return; }
          chunks.push(event.data);
        };
        active.onerror = () => fail(new Error("Microphone capture failed. Try recording again."));
        active.onstop = () => {
          release(); recorder = null;
          if (epoch !== generation) return;
          const blob = new Blob(chunks, { type: active.mimeType || mimeType || "audio/webm" });
          void blob.arrayBuffer().then(async buffer => {
            if (epoch !== generation) return;
            const request = dictation.transcribe(new Uint8Array(buffer), blob.type, status => {
              if (epoch === generation) preparing = status === "preparing";
            });
            transcription = request;
            const text = await request.result;
            if (epoch !== generation) return;
            transcription = null;
            onText(text, true); onEnd();
          }).catch(fail);
        };
        active.start(250);
        // Leave encoding and event-loop jitter below the server's 30 s limit.
        timeout = setTimeout(() => { if (epoch === generation && active.state !== "inactive") active.stop(); }, 29000);
        onStarted();
      }).catch(fail);
    },
    finish() { if (recorder?.state !== "inactive") recorder?.stop(); },
    stop,
  };
}

export function browserRecognition(dictation?: BrowserDictation): RecognitionPort | null {
  const host = window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  const fallback = dictation ? recordedRecognition(dictation) : null;
  if (!Constructor) return fallback;
  let current: BrowserRecognition | null = null;
  let usingFallback = false;
  let finishing = false;
  return {
    finishTimeoutS: fallback?.finishTimeoutS,
    transcriptionStatus: () => fallback?.transcriptionStatus?.() ?? "Transcribing…",
    start(onText, onError, onEnd, onStarted) {
      usingFallback = false;
      finishing = false;
      const recognition = new Constructor();
      current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onstart = onStarted;
      recognition.onresult = event => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          onText(result[0].transcript, result.isFinal);
        }
      };
      recognition.onerror = event => {
        if (fallback && !finishing && ["network", "service-not-allowed", "language-not-supported"].includes(event.error)) {
          recognition.onend = recognition.onerror = recognition.onresult = recognition.onstart = null;
          recognition.abort(); current = null;
          usingFallback = true;
          fallback.start(onText, onError, onEnd, onStarted);
        } else onError(event.error);
      };
      recognition.onend = onEnd;
      recognition.start();
    },
    finish() { finishing = true; if (usingFallback) fallback?.finish?.(); else current?.stop(); },
    stop() {
      fallback?.stop(); usingFallback = false;
      if (!current) return;
      current.onstart = null; current.onresult = null; current.onerror = null; current.onend = null;
      current.abort(); current = null;
    },
  };
}

export function browserSynthesis(): SynthesisPort | null {
  if (!window.speechSynthesis) return null;
  return {
    speak(text, onEnd) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
      window.speechSynthesis.speak(utterance);
    },
    stop() { window.speechSynthesis.cancel(); },
  };
}
