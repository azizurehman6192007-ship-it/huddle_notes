"use client";

/**
 * Serialised, retrying chunk uploader.
 *
 * Chunks must land in order — finalize concatenates them by `seq` to rebuild
 * one continuous container — so this is a queue, not a fan-out. A chunk that
 * fails is retried with backoff and everything behind it waits.
 */

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 600;

export interface ChunkUploaderOptions {
  meetingId: string;
  /** Provisional — the browser picks the real one, see setMimeType. */
  mimeType: string;
  /** Surfaced to the UI so the lead knows uploads are behind, not lost. */
  onPendingChange?: (pending: number) => void;
  onFailure?: (message: string) => void;
}

export class ChunkUploader {
  private queue: { seq: number; blob: Blob }[] = [];
  private draining = false;
  private failed = false;
  private mimeType: string;

  constructor(private readonly options: ChunkUploaderOptions) {
    this.mimeType = options.mimeType;
  }

  /**
   * MediaRecorder only reports the container it actually chose once it has
   * started, which is after the uploader has to exist. The first chunk cannot
   * arrive before the first timeslice elapses, so this always lands in time.
   */
  setMimeType(mimeType: string): void {
    if (mimeType) this.mimeType = mimeType;
  }

  enqueue(blob: Blob, seq: number): void {
    this.queue.push({ seq, blob });
    this.options.onPendingChange?.(this.queue.length);
    void this.drain();
  }

  /** Resolves once every enqueued chunk has been accepted by the server. */
  async flush(): Promise<void> {
    await this.drain();
    if (this.failed) {
      throw new Error("Some audio couldn't be uploaded.");
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0 && !this.failed) {
        const next = this.queue[0];
        const ok = await this.send(next.seq, next.blob);
        if (!ok) {
          this.failed = true;
          this.options.onFailure?.(
            "Part of the recording couldn't be uploaded. Check your connection — the huddle is still recording.",
          );
          break;
        }
        this.queue.shift();
        this.options.onPendingChange?.(this.queue.length);
      }
    } finally {
      this.draining = false;
    }
  }

  private async send(seq: number, blob: Blob): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(
          `/api/meetings/${this.options.meetingId}/chunk?seq=${seq}&mime=${encodeURIComponent(this.mimeType)}`,
          {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: blob,
          },
        );

        if (response.ok) return true;
        // 4xx other than 429 will not get better by trying again.
        if (response.status < 500 && response.status !== 429) return false;
      } catch {
        // Network blip. Fall through to the backoff.
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)),
        );
      }
    }
    return false;
  }
}
