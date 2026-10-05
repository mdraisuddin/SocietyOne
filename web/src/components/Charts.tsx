import { useState } from 'react';

/**
 * Minimal, dependency-free SVG charts.
 * Colour rules: categorical series use the fixed slot order (--series-1..8), values and labels use text tokens,
 * thin bars with rounded data ends, recessive grid, hover tooltips, legend when >= 2 series.
 */
export interface Series {
  key: string;
  label: string;
  color: string;
}

export function StackedBars({ data, series, labelFor, height = 220, ariaLabel }: { data: Record<string, any>[]; series: Series[]; labelFor: (d: any, i: number) => string; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { l: 34, r: 8, t: 10, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const max = Math.max(4, ...totals);
  const niceMax = Math.ceil(max / 4) * 4;
  const step = innerW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, step * 0.62));
  const y = (v: number) => pad.t + innerH - (v / niceMax) * innerH;
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
  const labelEvery = Math.ceil(data.length / 10);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} strokeWidth={1} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {Math.round(t)}
            </text>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={pad.l + step * i + step / 2} y={height - 8} textAnchor="middle">
                {labelFor(d, i)}
              </text>
            ) : null,
          )}
        </g>
        {data.map((d, i) => {
          let acc = 0;
          const x = pad.l + step * i + (step - barW) / 2;
          const segs = series.filter((s) => (d[s.key] ?? 0) > 0);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + step * i} y={pad.t} width={step} height={innerH} fill="transparent" />
              {segs.map((s, si) => {
                const v = d[s.key];
                const y1 = y(acc + v);
                const h = y(acc) - y1;
                acc += v;
                const top = si === segs.length - 1;
                // 2px surface gap between stacked segments
                return <path key={s.key} d={roundedTop(x, y1 + (si > 0 ? 0 : 0), barW, Math.max(0, h - (si > 0 ? 2 : 0)), top ? 4 : 0)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
              })}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((pad.l + step * hover + step / 2) / width) * 100}%`, top: `${(y(totals[hover]) / height) * 100}%` }}>
          <div className="strong">{labelFor(data[hover], hover)}</div>
          {series.map((s) => (
            <div key={s.key} className="row" style={{ gap: 6 }}>
              <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}: <strong>{data[hover][s.key] ?? 0}</strong>
            </div>
          ))}
          {series.length > 1 && (
            <div className="muted">
              Total: <strong>{totals[hover]}</strong>
            </div>
          )}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Horizontal bars for ranked categories — single series, so no legend; labels in text ink. */
export function HBars({ rows, color = 'var(--series-1)', format = (v: number) => String(v) }: { rows: { label: string; value: number; color?: string }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar" role="list">
      {rows.map((r) => (
        <div key={r.label} className="hbar-row" role="listitem" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate secondary">{r.label}</span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
          <span className="v">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
