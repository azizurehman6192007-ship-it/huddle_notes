/**
 * Hand-maintained mirror of supabase/migrations. Regenerate with
 * `npx supabase gen types typescript --linked > lib/supabase/types.ts`
 * once the project is linked; until then, keep this in step with the SQL.
 *
 * Everything here is a `type`, not an `interface`, on purpose: postgrest-js
 * constrains rows to `Record<string, unknown>`, and only type aliases get the
 * implicit index signature that satisfies it.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MeetingStatus =
  | "recording"
  | "uploading"
  | "processing"
  | "draft"
  | "sent"
  /** Finished, but nobody said anything. Never a pipeline fault. */
  | "empty"
  | "failed";

export type ProcessingStage = "transcribing" | "writing_notes" | "making_pdf";

export type TranscribeLanguage = "en" | "ur" | "auto";

export type MemberRole = "lead" | "member";

export type TeamRow = {
  id: string;
  name: string;
  watermark_text: string | null;
  logo_url: string | null;
  transcribe_language: TranscribeLanguage;
  created_at: string;
};

export type MemberRow = {
  id: string;
  team_id: string;
  name: string;
  email: string;
  role: MemberRole;
  receives_notes: boolean;
  active: boolean;
  created_at: string;
};

/** Groq whisper `verbose_json`, narrowed to what we actually read. */
export type TranscriptJson = {
  text: string;
  duration?: number;
  language?: string;
  segments?: { id: number; start: number; end: number; text: string }[];
};

export type MeetingRow = {
  id: string;
  team_id: string;
  title: string;
  meeting_date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  status: MeetingStatus;
  failure_reason: string | null;
  audio_path: string | null;
  audio_mime: string | null;
  audio_deleted_at: string | null;
  transcript: string | null;
  transcript_json: TranscriptJson | null;
  notes_json: Json | null;
  notes_edited: boolean;
  pdf_path: string | null;
  processing_stage: ProcessingStage | null;
  sent_at: string | null;
  sent_count: number | null;
  created_by: string | null;
  created_at: string;
};

export type MeetingAttendeeRow = {
  meeting_id: string;
  member_id: string;
  present: boolean;
};

export type SpeakerSegmentRow = {
  id: number;
  meeting_id: string;
  member_id: string | null;
  start_ms: number;
  end_ms: number | null;
};

export type ActionItemRow = {
  id: string;
  meeting_id: string;
  owner_member_id: string | null;
  owner_name_raw: string | null;
  owner_confidence: "high" | "low";
  task: string;
  due_date: string | null;
  status: string;
};

export type EmailLogRow = {
  id: number;
  meeting_id: string;
  email: string;
  provider_id: string | null;
  status: string | null;
  sent_at: string;
};

export type ActionItemInsert = {
  meeting_id: string;
  owner_member_id: string | null;
  owner_name_raw: string | null;
  owner_confidence: "high" | "low";
  task: string;
  due_date: string | null;
};

export type MeetingChunkRow = {
  meeting_id: string;
  seq: number;
  path: string;
  bytes: number;
  created_at: string;
};

export type MeetingJobRow = {
  msg_id: number;
  read_ct: number;
  message: Json;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "12" };
  public: {
    Tables: {
      teams: Table<TeamRow, "name">;
      members: Table<MemberRow, "team_id" | "name" | "email">;
      meetings: Table<MeetingRow, "team_id" | "title">;
      meeting_attendees: Table<MeetingAttendeeRow, "meeting_id" | "member_id">;
      speaker_segments: Table<SpeakerSegmentRow, "meeting_id" | "start_ms">;
      action_items: Table<ActionItemRow, "meeting_id" | "task">;
      email_log: Table<EmailLogRow, "meeting_id" | "email">;
      meeting_chunks: Table<
        MeetingChunkRow,
        "meeting_id" | "seq" | "path" | "bytes"
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_team: {
        Args: { p_team_name: string; p_lead_name: string };
        Returns: string;
      };
      enqueue_meeting: {
        Args: { p_meeting_id: string };
        Returns: number;
      };
      read_meeting_jobs: {
        Args: { p_qty: number; p_visibility_sec: number };
        Returns: MeetingJobRow[];
      };
      ack_meeting_job: {
        Args: { p_msg_id: number };
        Returns: boolean;
      };
      archive_meeting_job: {
        Args: { p_msg_id: number };
        Returns: boolean;
      };
    };
    Enums: {
      meeting_status: MeetingStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
