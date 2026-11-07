import { useEffect, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { displayTime, normalizeTime } from "./model";
import FormField from "./FormField";
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
  path?: string;
  required?: boolean;
};
export default function TimeField({
  label,
  value = "",
  onChange,
  onBlur,
  hint,
  error,
  compact = false,
  path,
  required,
}: Props) {
  const safeValue = typeof value === "string" ? value : "",
    [text, setText] = useState(safeValue),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(safeValue);
    setInvalid(Boolean(safeValue && normalizeTime(safeValue) === null));
  }, [safeValue]);
  const detail =
    safeValue && normalizeTime(safeValue)
      ? `${displayTime(safeValue)} · WIB`
      : "24-hour time · WIB";
  return (
    <FormField
      label={label}
      path={path}
      value={text}
      required={required}
      error={invalid ? "Enter a time such as 17:30 or 5:30 pm." : error}
      hint={!compact ? `${detail}${hint ? " — " + hint : ""}` : hint}
    >
      {(attrs) => {
        const commit = () => {
          const normalized = normalizeTime(text);
          setInvalid(normalized === null);
          if (normalized !== null) setText(normalized);
          onChange(normalized ?? text);
          onBlur?.();
        };
        return (
          <div className="op-time-control">
            <Clock3 size={17} aria-hidden="true" />
            <input
              {...attrs}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="HH:MM or 5:30 pm"
              value={text}
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
        );
      }}
    </FormField>
  );
}
