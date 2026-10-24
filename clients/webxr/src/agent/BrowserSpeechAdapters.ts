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

export function browserRecognition(): RecognitionPort | null {
  const host = window as unknown as { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Constructor) return null;
  let current: BrowserRecognition | null = null;
  return {
    start(onText, onError, onEnd, onStarted) {
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
      recognition.onerror = event => onError(event.error);
      recognition.onend = onEnd;
      recognition.start();
    },
    finish() { current?.stop(); },
    stop() {
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
