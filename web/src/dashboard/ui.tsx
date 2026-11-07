import type { ReactNode, ButtonHTMLAttributes } from "react";
import { ArrowRight, ArrowUpRight, Info } from "lucide-react";
export { Brand, BrandMark } from "../brand/Brand";
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
export function GbkDemoLink() {
  return (
    <a
      className="op-button op-demo-link"
      href="/simulation/workspace?version=baseline&view=isometric&panel=controls"
      target="_blank"
      rel="noopener"
      aria-label="Try the GBK demo (opens in a new tab)"
    >
      Try the GBK demo
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
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
  fieldPath,
}: {
  fieldPath?: string;
  title?: ReactNode;
  tag?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="op-card" data-field-path={fieldPath}>
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
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
export const Forward = () => <ArrowRight size={17} />;
