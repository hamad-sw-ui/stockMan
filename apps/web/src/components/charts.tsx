/** Graphiques SVG autonomes (aucune dépendance externe — maîtrise totale des
 *  assets, cf. FRN-02). Ligne/zone, barres verticales et anneau avec légende. */
import { useMemo, useState } from "react";
import { formatMoney, formatQty } from "../lib/format";

/* ------------------------------ Courbe (zone) ------------------------------ */
export function LineChart({
  points,
  height = 190,
  formatValue = (v: number) => formatQty(v),
}: {
  points: Array<{ label: string; value: number }>;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const PAD = { t: 14, r: 12, b: 24, l: 44 };

  const { path, area, dots, max, gridY } = useMemo(() => {
    const values = points.map((p) => p.value);
    const maxV = Math.max(1, ...values);
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (i: number) =>
      PAD.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => PAD.t + ih - (v / maxV) * ih;
    const seg = points.map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`,
    );
    const p = seg.join(" ");
    const a = `${p} L${x(points.length - 1).toFixed(1)},${(H - PAD.b).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD.b).toFixed(1)} Z`;
    return {
      path: p,
      area: a,
      dots: points.map((pt, i) => ({ x: x(i), y: y(pt.value) })),
      max: maxV,
      gridY: [0.25, 0.5, 0.75, 1].map((f) => PAD.t + ih - f * ih),
    };
  }, [points, H]);

  if (points.length === 0)
    return <p className="muted">Aucune donnée sur la période.</p>;

  const top = hover != null ? dots[hover] : null;
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label="Évolution des ventes"
      >
        {gridY.map((y, i) => (
          <g key={i}>
            <line
              className="grid-line"
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y}
              y2={y}
            />
            <text
              className="axis-label"
              x={PAD.l - 6}
              y={y + 3}
              textAnchor="end"
            >
              {formatValue(max * [0.25, 0.5, 0.75, 1][i]!).replace(
                /\s?FCFA/,
                "",
              )}
            </text>
          </g>
        ))}
        <path className="area" d={area} />
        <path className="line" d={path} />
        {dots.map((d, i) => (
          <circle
            key={i}
            className="dot"
            cx={d.x}
            cy={d.y}
            r={hover === i ? 5 : 3}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${points[i]!.label} — ${formatValue(points[i]!.value)}`}</title>
          </circle>
        ))}
        {/* étiquettes X espacées */}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
            <text
              key={i}
              className="axis-label"
              x={dots[i]!.x}
              y={H - 6}
              textAnchor="middle"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      {top != null && hover != null ? (
        <div
          className="muted"
          style={{ fontSize: "0.85rem", textAlign: "center" }}
        >
          {points[hover]!.label} :{" "}
          <strong>{formatValue(points[hover]!.value)}</strong>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Barres verticales -------------------------- */
export function BarChart({
  bars,
  height = 170,
  formatValue = (v: number) => formatQty(v),
  color,
}: {
  bars: Array<{ label: string; value: number }>;
  height?: number;
  formatValue?: (v: number) => string;
  color?: string;
}) {
  const W = 640;
  const H = height;
  const PAD = { t: 18, r: 10, b: 26, l: 44 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = bars.length ? Math.min(46, (iw / bars.length) * 0.62) : 20;
  if (bars.length === 0) return <p className="muted">Aucune donnée.</p>;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart"
      role="img"
      aria-label="Graphique en barres"
    >
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line
            className="grid-line"
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + ih - f * ih}
            y2={PAD.t + ih - f * ih}
          />
          <text
            className="axis-label"
            x={PAD.l - 6}
            y={PAD.t + ih - f * ih + 3}
            textAnchor="end"
          >
            {formatValue(max * f).replace(/\s?FCFA/, "")}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = PAD.l + (i + 0.5) * (iw / bars.length) - bw / 2;
        const h = (b.value / max) * ih;
        return (
          <g key={i}>
            <rect
              className="bar"
              style={color ? { fill: color } : undefined}
              x={x}
              y={PAD.t + ih - h}
              width={bw}
              height={Math.max(h, 1)}
            >
              <title>{`${b.label} — ${formatValue(b.value)}`}</title>
            </rect>
            <text
              className="axis-label"
              x={x + bw / 2}
              y={H - 8}
              textAnchor="middle"
            >
              {b.label.length > 9 ? `${b.label.slice(0, 8)}…` : b.label}
            </text>
            {b.value > 0 ? (
              <text
                className="axis-label"
                x={x + bw / 2}
                y={PAD.t + ih - h - 4}
                textAnchor="middle"
                style={{ fontWeight: 700 }}
              >
                {formatValue(b.value).replace(/\s?FCFA/, "")}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/* -------------------------------- Anneau ----------------------------------- */
const DONUT_COLORS = [
  "#059669",
  "#2563eb",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
];

export function Donut({
  segments,
  formatValue = (v: number) => formatMoney(v),
}: {
  segments: Array<{ label: string; value: number; color?: string }>;
  formatValue?: (v: number) => string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 54;
  const CX = 62;
  const CY = 62;
  const circumference = 2 * Math.PI * R;
  let offset = 0;
  if (total <= 0) return <p className="muted">Aucune donnée.</p>;
  return (
    <div className="row" style={{ alignItems: "center", gap: 20 }}>
      <svg
        viewBox="0 0 124 124"
        className="chart"
        style={{ maxWidth: 150 }}
        role="img"
        aria-label="Répartition"
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth="16"
        />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const dash = `${(frac * circumference).toFixed(2)} ${(circumference - frac * circumference).toFixed(2)}`;
          const off = -offset * circumference;
          offset += frac;
          return (
            <circle
              key={i}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={s.color ?? DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={dash}
              strokeDashoffset={off}
              transform={`rotate(-90 ${CX} ${CY})`}
            >
              <title>{`${s.label} — ${formatValue(s.value)}`}</title>
            </circle>
          );
        })}
      </svg>
      <div
        className="legend"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}
      >
        {segments.map((s, i) => (
          <span key={i} className="key">
            <span
              className="swatch"
              style={{
                background: s.color ?? DONUT_COLORS[i % DONUT_COLORS.length],
              }}
            />
            {s.label} — <strong>{formatValue(s.value)}</strong>{" "}
            <span className="muted">
              ({Math.round((s.value / total) * 100)} %)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
