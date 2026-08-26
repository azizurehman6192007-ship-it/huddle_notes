"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/util/cx";

/**
 * §8D: click the text, it becomes an input, blur saves. No modals, no separate
 * edit mode. Escape abandons the edit; Enter commits (Shift+Enter for a new
 * line in multiline fields).
 */
export function EditableText({
  value,
  onSave,
  multiline,
  placeholder = "Add a note",
  ariaLabel,
  className,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    if (multiline) autoGrow(field as HTMLTextAreaElement);
  }, [editing, multiline]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== value.trim()) void onSave(next);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  const shared = cx(
    "w-full resize-none rounded-[var(--radius)] bg-paper-sunk px-2 py-1",
    "text-inherit outline-none",
    className,
  );

  if (editing) {
    return multiline ? (
      <textarea
        ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
        aria-label={ariaLabel}
        value={draft}
        rows={1}
        onChange={(event) => {
          setDraft(event.target.value);
          autoGrow(event.target);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            commit();
          }
        }}
        className={shared}
      />
    ) : (
      <input
        ref={fieldRef as React.RefObject<HTMLInputElement>}
        aria-label={ariaLabel}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        className={shared}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`${ariaLabel}. Click to edit.`}
      className={cx(
        "w-full rounded-[var(--radius)] px-2 py-1 text-left",
        "hover:bg-paper-sunk",
        !value.trim() && "text-ink-3 italic",
        className,
      )}
    >
      {value.trim() || placeholder}
    </button>
  );
}

/** Keeps a multiline field the height of its content, so nothing scrolls. */
function autoGrow(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}
