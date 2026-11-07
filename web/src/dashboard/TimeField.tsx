import { useEffect, useId, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { displayTime, normalizeTime } from "./model";
const choices = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
);
type Props = {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hint?: string;
  error?: string;
  compact?: boolean;
};
export default function TimeField({
  label,
  value = "",
  onChange,
  onBlur,
  hint,
  error,
  compact = false,
}: Props) {
  const id = useId(),
    [text, setText] = useState(value),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value);
    setInvalid(Boolean(value && normalizeTime(value) === null));
  }, [value]);
  function commit() {
    const normalized = normalizeTime(text);
    setInvalid(normalized === null);
    if (normalized !== null) setText(normalized);
    onChange(normalized ?? text);
    onBlur?.();
  }
  const message = invalid
    ? "Enter a time like 17:30 or 5:30 pm, or leave it blank."
    : error;
  const detail =
    value && normalizeTime(value) ? `${displayTime(value)} · WIB` : undefined;
  return (
    <div className={`op-field op-time-field ${message ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="op-time-control">
        <Clock3 size={17} aria-hidden="true" />
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="HH:MM or 5:30 pm"
          value={text}
          aria-invalid={Boolean(message)}
          aria-describedby={
            message || hint || !compact ? `${id}-help` : undefined
          }
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <span className="op-time-picker">
          <span aria-hidden="true">
            Choose
            <ChevronDown size={13} />
          </span>
          <select
            aria-label={`Choose ${label.toLowerCase()}`}
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setText(e.target.value);
                setInvalid(false);
                onChange(e.target.value);
                onBlur?.();
              }
            }}
          >
            <option value="" disabled>
              Choose a time · 24-hour
            </option>
            {choices.map((time) => (
              <option key={time} value={time}>
                {time} · {displayTime(time)}
              </option>
            ))}
          </select>
        </span>
      </div>
      {(message || hint || !compact) && (
        <small id={`${id}-help`} className={message ? "op-error" : ""}>
          {message ?? (
            <>
              {!compact && (
                <span>
                  {detail ?? "24-hour time · WIB"}
                  {hint ? " — " : ""}
                </span>
              )}
              {hint}
            </>
          )}
        </small>
      )}
    </div>
  );
}
