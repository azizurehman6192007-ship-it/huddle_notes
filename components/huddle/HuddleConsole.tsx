"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ledger, type LedgerMember } from "@/components/ledger/Ledger";
import { RecordButton } from "@/components/recorder/RecordButton";
import { Timer } from "@/components/recorder/Timer";
import { Waveform } from "@/components/recorder/Waveform";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { cx } from "@/lib/util/cx";
import {
  MicrophoneError,
  isRecordingSupported,
  keepScreenAwake,
  startRecording,
  type RecorderHandle,
} from "@/lib/audio/recorder";
import { ChunkUploader } from "@/lib/audio/uploader";

/**
 * The recording half of the product: the start card on the home screen, and
 * the full-screen surface it opens into.
 *
 * Everything after Stop — processing, notes, sending — lives on the huddle's
 * own page. Home stays home, so there is always one obvious way back to it.
 */
type Local =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "starting"; meetingId: string }
  | { kind: "recording"; meetingId: string }
  | { kind: "finalizing"; meetingId: string }
  | { kind: "blocked"; meetingId: string; message: string };

export function HuddleConsole({
  members,
  memberCount,
}: {
  members: LedgerMember[];
  memberCount: number;
}) {
  const router = useRouter();
  const toast = useToast();

  const [local, setLocal] = useState<Local>({ kind: "idle" });
  const [presentIds, setPresentIds] = useState<Set<string>>(
    () => new Set(members.map((member) => member.id)),
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const uploaderRef = useRef<ChunkUploader | null>(null);
  const releaseWakeLockRef = useRef<(() => void) | null>(null);

  /**
   * Feature detection must not happen during render. This is a client
   * component, but Next still server-renders it, and `isRecordingSupported()`
   * reads `window` — so it answers false on the server and true in the
   * browser. That flipped StartCard between a <div> and a <button>, which is
   * a hydration mismatch, not a cosmetic one.
   *
   * Assume support for the first paint (true on every browser we target) so
   * server and client agree, then correct it after mount.
   */
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(isRecordingSupported());
  }, []);

  const capturing =
    local.kind === "starting" ||
    local.kind === "recording" ||
    local.kind === "finalizing";

  useEffect(() => {
    if (local.kind !== "recording") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [local.kind]);

  useEffect(() => {
    if (local.kind !== "recording") return;
    const resume = () => void recorderRef.current?.resumeAnalyser();
    window.addEventListener("pointerdown", resume, { once: true });
    return () => window.removeEventListener("pointerdown", resume);
  }, [local.kind]);

  useEffect(() => {
    return () => {
      releaseWakeLockRef.current?.();
      void recorderRef.current?.stop().catch(() => {});
    };
  }, []);

  const toggleMember = useCallback(
    (memberId: string, meetingId: string) => {
      const present = !presentIds.has(memberId);
      setPresentIds((current) => {
        const next = new Set(current);
        if (present) next.add(memberId);
        else next.delete(memberId);
        return next;
      });
      void upsertAttendee(meetingId, memberId, present);
    },
    [presentIds],
  );

  async function beginHuddle() {
    setLocal({ kind: "creating" });

    let meetingId: string;
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Daily standup" }),
      });
      if (!response.ok) throw new Error("create failed");
      meetingId = ((await response.json()) as { id: string }).id;
    } catch {
      setLocal({ kind: "idle" });
      toast.show(
        "Couldn't start the huddle. Check your connection and try again.",
        "error",
      );
      return;
    }

    await startCapture(meetingId);
  }

  async function startCapture(meetingId: string) {
    setLocal({ kind: "starting", meetingId });
    void persistAttendees(meetingId, members, presentIds);

    const uploader = new ChunkUploader({
      meetingId,
      mimeType: "audio/webm",
      onPendingChange: setPendingChunks,
      onFailure: (message) => toast.show(message, "error"),
    });
    uploaderRef.current = uploader;

    try {
      const recorder = await startRecording({
        onChunk: (blob, seq) => uploader.enqueue(blob, seq),
        onError: (message) => toast.show(message, "error"),
      });

      uploader.setMimeType(recorder.mimeType);
      recorderRef.current = recorder;
      releaseWakeLockRef.current = await keepScreenAwake();

      setAnalyser(recorder.analyser);
      setStartedAt(Date.now());
      setLocal({ kind: "recording", meetingId });
    } catch (caught) {
      setLocal({
        kind: "blocked",
        meetingId,
        message:
          caught instanceof MicrophoneError
            ? caught.message
            : "Couldn't start recording. Try again.",
      });
    }
  }

  async function stopHuddle() {
    if (local.kind !== "recording") return;
    const { meetingId } = local;
    const recorder = recorderRef.current;
    const uploader = uploaderRef.current;
    if (!recorder || !uploader) return;

    setLocal({ kind: "finalizing", meetingId });
    releaseWakeLockRef.current?.();
    releaseWakeLockRef.current = null;

    const durationSec = startedAt ? (Date.now() - startedAt) / 1000 : 0;

    try {
      await recorder.stop();
      recorderRef.current = null;
      await uploader.flush();

      const response = await fetch(`/api/meetings/${meetingId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ durationSec, mime: recorder.mimeType }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        discarded?: boolean;
        reason?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "finalize failed");

      setLocal({ kind: "idle" });
      setStartedAt(null);

      if (payload.discarded) {
        toast.show(
          payload.reason ?? "Nothing was recorded, so that huddle wasn't saved.",
        );
      }

      // Straight back to the home list, where the huddle just recorded is the
      // top row and shows its own status as it processes.
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setLocal({ kind: "recording", meetingId });
      toast.show(
        caught instanceof Error && caught.message !== "finalize failed"
          ? caught.message
          : "Couldn't finish saving the huddle. Check your connection, then press stop again.",
        "error",
      );
    }
  }

  if (!capturing && local.kind !== "blocked") {
    return (
      <StartCard
        busy={local.kind === "creating"}
        memberCount={memberCount}
        supported={supported}
        onStart={() => void beginHuddle()}
      />
    );
  }

  const blocked = local.kind === "blocked";

  return (
    <div
      data-surface={blocked ? undefined : "dark"}
      className="fixed inset-0 z-30 bg-paper text-ink"
    >
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <span
              aria-hidden
              className={cx(
                "block size-2 rounded-full",
                local.kind === "recording" ? "live-dot bg-live" : "bg-ink-3",
              )}
            />
            <span className="font-mono text-xs tracking-wide uppercase">
              {local.kind === "recording"
                ? "Rec"
                : local.kind === "finalizing"
                  ? "Saving"
                  : blocked
                    ? "Mic blocked"
                    : "Mic"}
            </span>
          </span>
          <Timer
            startedAt={startedAt}
            running={local.kind === "recording"}
            className="text-lg text-ink-3"
          />
        </header>

        {blocked ? (
          <Card tier="base" padding="base" className="shrink-0" role="alert">
            <p className="text-sm text-live">{local.message}</p>
          </Card>
        ) : (
          <Card
            tier="low"
            padding="none"
            elevation={0}
            className="h-20 shrink-0 px-4 py-5"
          >
            <Waveform analyser={analyser} />
          </Card>
        )}

        <h2 className="eyebrow mt-5 mb-2 shrink-0">In the room</h2>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Ledger
            mode="live"
            members={members}
            presentIds={presentIds}
            onToggle={
              local.kind === "finalizing"
                ? undefined
                : (memberId) => toggleMember(memberId, local.meetingId)
            }
          />
        </div>

        <div className="mt-6 flex shrink-0 flex-col items-center gap-3">
          {local.kind === "finalizing" ? (
            <>
              <Button variant="secondary" size="lg" busy>
                Saving the huddle…
              </Button>
              <p className="font-mono text-xs text-ink-3">
                Uploading the last few seconds
              </p>
            </>
          ) : (
            <>
              <RecordButton
                recording={local.kind === "recording"}
                busy={local.kind === "starting"}
                onClick={
                  local.kind === "recording"
                    ? stopHuddle
                    : () => void startCapture(local.meetingId)
                }
              />
              <p className="font-mono text-xs text-ink-3">
                {local.kind === "recording"
                  ? pendingChunks > 0
                    ? "Saving…"
                    : "Saved automatically"
                  : local.kind === "starting"
                    ? "Waiting for the mic…"
                    : "Try again"}
              </p>
            </>
          )}

          {blocked && (
            <button
              type="button"
              onClick={() => {
                setLocal({ kind: "idle" });
                router.replace("/");
                router.refresh();
              }}
              className="state-layer rounded-full px-4 py-2 text-sm text-ink-2 hover:text-ink"
            >
              Back to huddles
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StartCard({
  busy,
  memberCount,
  supported,
  onStart,
}: {
  busy: boolean;
  memberCount: number;
  supported: boolean;
  onStart: () => void;
}) {
  if (memberCount === 0) {
    return (
      <Card
        as="a"
        href="/team"
        interactive
        outlined
        padding="loose"
        className="flex flex-col items-center gap-1.5 border-dashed py-12 text-center"
      >
        <span
          aria-hidden
          className="mb-1 grid size-12 place-items-center rounded-full bg-paper-sunk text-xl text-ink-3"
        >
          +
        </span>
        <span className="font-display text-lg text-ink">Add your team first</span>
        <span className="max-w-xs text-sm text-ink-2">
          Notes need names. Add the people who join the huddle.
        </span>
      </Card>
    );
  }

  if (!supported) {
    return (
      <Card padding="loose" className="text-center">
        <p className="font-display text-lg text-ink">
          This browser can&apos;t record
        </p>
        <p className="mt-1 text-sm text-ink-2">
          Huddle needs the microphone APIs in Chrome, Edge or Safari.
        </p>
      </Card>
    );
  }

  return (
    <Card
      as="button"
      type="button"
      onClick={onStart}
      disabled={busy}
      interactive
      elevation={2}
      padding="none"
      className="w-full py-12 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="relative grid size-20 place-items-center rounded-full bg-live/10"
        >
          <span className="absolute inset-0 rounded-full ring-1 ring-live/15" />
          <span className="block size-9 rounded-full bg-live shadow-e1" />
        </span>

        <span className="flex flex-col items-center gap-1">
          <span className="font-display text-2xl text-ink">
            {busy ? "Starting…" : "Start huddle"}
          </span>
          <span className="tabular font-mono text-xs text-ink-3">
            Daily standup · {memberCount}{" "}
            {memberCount === 1 ? "person" : "people"}
          </span>
        </span>
      </span>
    </Card>
  );
}

async function persistAttendees(
  meetingId: string,
  members: LedgerMember[],
  presentIds: Set<string>,
) {
  try {
    const supabase = createClient();
    await supabase.from("meeting_attendees").upsert(
      members.map((member) => ({
        meeting_id: meetingId,
        member_id: member.id,
        present: presentIds.has(member.id),
      })),
      { onConflict: "meeting_id,member_id" },
    );
  } catch {
    // Presence is an assist, never a requirement.
  }
}

async function upsertAttendee(
  meetingId: string,
  memberId: string,
  present: boolean,
) {
  try {
    const supabase = createClient();
    await supabase
      .from("meeting_attendees")
      .upsert(
        { meeting_id: meetingId, member_id: memberId, present },
        { onConflict: "meeting_id,member_id" },
      );
  } catch {
    // Presence is an assist, never a requirement.
  }
}
