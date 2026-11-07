import "@fontsource/jost/latin-600.css";
import stadiumMark from "./stadium-o.svg";
import "./brand.css";

export function BrandMark() {
  return (
    <img
      className="op-mark"
      src={stadiumMark}
      width={32}
      height={32}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function Brand({ mark = true }: { mark?: boolean }) {
  return (
    <span className="op-brand" role="img" aria-label="Opsidio">
      {mark && <BrandMark />}
      <span className="op-wordmark" aria-hidden="true">
        opsidio<span className="op-brand-dot">.</span>
      </span>
    </span>
  );
}
