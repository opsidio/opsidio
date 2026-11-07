import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { CircleAlert } from "lucide-react";
import { isRequiredField, type Issue, type Plan } from "./model";
export type FormValidation = {
  plan: Plan;
  issues: Issue[];
  submitted: boolean;
  focusPath: string;
  attempt: number;
  touched: Set<string>;
  touch: (path: string) => void;
};
export const FormValidationContext = createContext<FormValidation | null>(null);
export const useFormValidation = () => useContext(FormValidationContext);
export function RequiredMark() {
  return (
    <span className="op-required" aria-hidden="true">
      *
    </span>
  );
}
export function FieldMessage({
  id,
  error,
  hint,
}: {
  id?: string;
  error?: string;
  hint?: ReactNode;
}) {
  if (!error && !hint) return null;
  return (
    <div
      id={id}
      className={`op-field-message ${error ? "op-field-error" : ""}`}
      role={error ? "alert" : undefined}
    >
      {error && <CircleAlert size={14} aria-hidden="true" />}
      <span>{error ?? hint}</span>
    </div>
  );
}
export function focusField(path: string) {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-field-path]"),
  );
  const node =
    nodes.find((n) => n.dataset.fieldPath === path) ??
    nodes.find((n) => path.startsWith((n.dataset.fieldPath ?? "") + "."));
  if (!node) return false;
  let parent: HTMLElement | null = node.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  const control =
    node.querySelector<HTMLElement>(
      "input:not([type=hidden]),select,textarea,button",
    ) ?? node;
  control.scrollIntoView({ behavior: "smooth", block: "center" });
  control.focus({ preventScroll: true });
  return true;
}
type Control = {
  id: string;
  className: string;
  required: boolean;
  "aria-required": boolean;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  onBlur: () => void;
};
type Props = {
  label: string;
  path?: string;
  value?: unknown;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: (attrs: Control) => ReactNode;
};
export default function FormField({
  label,
  path,
  value,
  required,
  error,
  hint,
  children,
}: Props) {
  const context = useFormValidation(),
    id = useId(),
    ref = useRef<HTMLDivElement>(null);
  const mandatory =
    required ?? (path && context ? isRequiredField(path, context.plan) : false);
  const show = Boolean(
    context && (context.submitted || (path && context.touched.has(path))),
  );
  const issue =
    show && path
      ? context?.issues.find((i) => i.path === path)?.message
      : undefined;
  const missing =
    mandatory &&
    (value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim()));
  const message =
    error ?? (show && missing ? "This field is required." : issue);
  useEffect(() => {
    if (path && context?.focusPath === path && context.attempt)
      focusField(path);
  }, [path, context?.focusPath, context?.attempt]);
  return (
    <div
      ref={ref}
      className={`op-field ${message ? "invalid" : ""}`}
      data-field-path={path}
    >
      <label htmlFor={id}>
        {label}
        {mandatory && <RequiredMark />}
      </label>
      {children({
        id,
        className: "op-input",
        required: Boolean(mandatory),
        "aria-required": Boolean(mandatory),
        "aria-invalid": Boolean(message),
        "aria-describedby": message || hint ? `${id}-help` : undefined,
        onBlur: () => {
          if (path) context?.touch(path);
        },
      })}
      <FieldMessage id={`${id}-help`} error={message} hint={hint} />
    </div>
  );
}
