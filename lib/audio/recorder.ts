"use client";

/**
 * MediaRecorder wrapper for the huddle.
 *
 * The important property here is that audio leaves the device *during* the
 * meeting, in timeslices, not as one blob at the end. A standup that already
 * happened is unrecoverable, so a crash at minute 11 must still cost us only
 * the last few seconds.
 */

export const CHUNK_MS = 5_000;

/** Ordered by preference. Opus is far smaller; mp4 is the Safari fallback. */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  );
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class MicrophoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrophoneError";
  }
}

/** Turns a getUserMedia rejection into something worth showing a person. */
function describeMicFailure(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Huddle needs microphone access to record. Allow the mic in your browser settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Plug one in or pick a different input, then try again.";
    case "NotReadableError":
      return "Another app is using the microphone. Close it and try again.";
    default:
      return "Couldn't start the microphone. Check your browser's mic settings and try again.";
  }
}

export interface RecorderOptions {
  /** Called for every timeslice, in order, while the meeting runs. */
  onChunk: (chunk: Blob, seq: number) => void;
  /** Fired when the browser aborts the recording under us. */
  onError?: (message: string) => void;
  timesliceMs?: number;
}

export interface RecorderHandle {
  readonly mimeType: string;
  readonly analyser: AnalyserNode;
  /**
   * Nudges a suspended AudioContext back to running. Call it from a real user
   * gesture — see the note where the context is created.
   */
  resumeAnalyser: () => Promise<void>;
  /** Resolves once the final timeslice has been handed to `onChunk`. */
  stop: () => Promise<{ chunkCount: number }>;
}

export async function startRecording(
  options: RecorderOptions,
): Promise<RecorderHandle> {
  if (!isRecordingSupported()) {
    throw new MicrophoneError(
      "This browser can't record audio. Try Chrome, Edge or Safari.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16_000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    throw new MicrophoneError(describeMicFailure(error));
  }

  const mimeType = pickMimeType();

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 24_000,
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new MicrophoneError(describeMicFailure(error));
  }

  // Real amplitude for the waveform. A fake animation is a lie about whether
  // the mic is working, and "was it recording?" is the biggest anxiety here.
  const audioContext = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  audioContext.createMediaStreamSource(stream).connect(analyser);

  // Autoplay policy hands back a suspended context when nothing on this page
  // has been tapped yet — which is now possible, because the huddle starts
  // from a tap on the previous screen. MediaRecorder is unaffected, but the
  // analyser would report pure silence, and a flat waveform on a working mic
  // is exactly the lie the waveform exists to prevent.
  const resumeAnalyser = async () => {
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
  };
  await resumeAnalyser();

  let seq = 0;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) options.onChunk(event.data, seq++);
  });

  recorder.addEventListener("error", () => {
    options.onError?.(
      "The recording stopped unexpectedly. Everything up to this point was saved.",
    );
  });

  const stopped = new Promise<void>((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
  });

  recorder.start(options.timesliceMs ?? CHUNK_MS);

  return {
    mimeType: recorder.mimeType || mimeType,
    analyser,
    resumeAnalyser,
    async stop() {
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close().catch(() => {});
      return { chunkCount: seq };
    },
  };
}

/** Best-effort screen lock. Never let its absence block a recording. */
export async function keepScreenAwake(): Promise<() => void> {
  type WakeLockSentinel = { release: () => Promise<void> };
  const api = (
    navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    }
  ).wakeLock;

  if (!api) return () => {};

  try {
    const sentinel = await api.request("screen");
    return () => void sentinel.release().catch(() => {});
  } catch {
    return () => {};
  }
}
