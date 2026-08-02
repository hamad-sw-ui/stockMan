/** Rendu SVG d'un code-barres Code 39 (+ texte lisible optionnel). */
import { useMemo } from "react";
import { code39Bars } from "../lib/barcode";

export function BarcodeSvg({
  value,
  height = 46,
  withText = true,
  className = "",
}: {
  value: string;
  height?: number;
  withText?: boolean;
  className?: string;
}) {
  const data = useMemo(() => code39Bars(value, height), [value, height]);
  const totalH = data.height + (withText ? 12 : 0);
  const label = value.toUpperCase();
  return (
    <svg
      viewBox={`0 0 ${data.width} ${totalH}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Code-barres ${label}`}
      className={className}
      style={{ display: "block", maxWidth: 260, margin: "0 auto" }}
    >
      {data.bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={b.h} fill="#000" />
      ))}
      {withText ? (
        <text
          x={data.width / 2}
          y={data.height + 10}
          textAnchor="middle"
          fontSize={9}
          fontFamily="monospace"
          fill="#000"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
