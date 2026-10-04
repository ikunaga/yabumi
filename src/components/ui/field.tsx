import type { ComponentProps, ReactNode } from "react";

// 枠 1px。フォーカス・エラー時は影を 1px 足して 2px に見せる（中身がずれない）
const control =
  "w-full rounded-md border bg-surface px-3.5 py-3 text-base text-fg placeholder:text-muted outline-none transition-colors duration-[120ms] max-sm:text-[16px]";
const normal = "border-input focus:border-primary focus:shadow-[0_0_0_1px_var(--primary)]";
const invalid = "border-danger shadow-[0_0_0_1px_var(--danger)]";

export function Field({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] leading-normal font-bold">
        {label}
        {required && <span className="ml-1.5 text-xs text-signal">必須</span>}
        {optional && <span className="ml-1.5 text-xs font-normal text-muted">任意</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type ControlProps = { invalid?: boolean };

export function Input({ invalid: isInvalid, className = "", ...props }: ComponentProps<"input"> & ControlProps) {
  return (
    <input
      aria-invalid={isInvalid || undefined}
      aria-describedby={props.id ? `${props.id}-${isInvalid ? "error" : "hint"}` : undefined}
      className={`${control} ${isInvalid ? invalid : normal} ${className}`}
      {...props}
    />
  );
}

export function Textarea({ invalid: isInvalid, className = "", ...props }: ComponentProps<"textarea"> & ControlProps) {
  return (
    <textarea
      rows={3}
      aria-invalid={isInvalid || undefined}
      aria-describedby={props.id ? `${props.id}-${isInvalid ? "error" : "hint"}` : undefined}
      className={`${control} ${isInvalid ? invalid : normal} resize-y ${className}`}
      {...props}
    />
  );
}
