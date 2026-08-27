import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/util/cx";

/**
 * Material's outlined text field, in §7's palette. Outlined rather than
 * filled because the screens it appears on are already card surfaces, and a
 * second tonal fill inside a card muddies the hierarchy.
 */
const FIELD_CLASSES = cx(
  "w-full h-12 px-3.5 rounded-[var(--radius)]",
  "bg-paper-raised text-ink placeholder:text-ink-3",
  "border border-hairline",
  "transition-[border-color,box-shadow] duration-150 ease-[var(--ease)]",
  "hover:border-ink-3",
  "focus:border-amber focus:outline-none focus:ring-1 focus:ring-amber",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

function Wrapper({
  id,
  label,
  hint,
  error,
  hideLabel,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Keeps the label for screen readers but drops it visually — for fields
   *  whose purpose is obvious from placement, like the huddle search. */
  hideLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cx(
          "text-sm font-medium text-ink-2",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-0.5 text-sm text-live">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="pl-0.5 text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hideLabel, className, id: idProp, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;

  return (
    <Wrapper id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(
          FIELD_CLASSES,
          error && "border-live focus:border-live focus:ring-live",
          className,
        )}
        {...props}
      />
    </Wrapper>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id: idProp, children, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;

  return (
    <Wrapper id={id} label={label} hint={hint} error={error}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(
          FIELD_CLASSES,
          error && "border-live focus:border-live focus:ring-live",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </Wrapper>
  );
});
