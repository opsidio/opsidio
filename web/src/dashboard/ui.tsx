import type { ReactNode, ButtonHTMLAttributes } from "react";
import { ArrowRight, Info } from "lucide-react";
export function Button({
  children,
  primary = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`op-button ${primary ? "primary" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`op-badge ${tone}`}>{children}</span>;
}
export function Card({
  title,
  tag,
  children,
  action,
}: {
  title?: string;
  tag?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="op-card">
      {title && (
        <header>
          <h2>{title}</h2>
          {tag}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
export function Notice({
  title,
  children,
  tone = "coral",
}: {
  title: string;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`op-notice ${tone}`}>
      <Info size={18} />
      <div>
        <strong>{title}</strong>
        <div className="op-notice-content">{children}</div>
      </div>
    </div>
  );
}
export function Brand({ mark = false }: { mark?: boolean }) {
  return (
    <span className="op-brand">
      {mark && <span className="op-mark" />}opsidio.
    </span>
  );
}
export function Heading({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="op-heading">
      <div>
        <h1>{title}</h1>
        {children && <div className="op-notice-content">{children}</div>}
      </div>
      {action}
    </div>
  );
}
export const Forward = () => <ArrowRight size={17} />;
