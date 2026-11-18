// رسم SVG لتاريخ السعر (نفس منطق العرض القديم: نقطة أولى ثم تغيّر،
// نقطة واحدة تُرسم كنقطة لا كخط يوحي بقياسات متعددة).
// لا يُخترع متوسط ولا قراءة؛ النقاط المعروضة هي المرصودة فقط.
import { formatEGP } from "../../src/lib/money.js";
import { formatDate } from "../lib/dates.js";

export function PriceChart({ points }) {
  const w = 720;
  const h = 220;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  if (!points || points.length === 0) {
    return <p className="text-muted">لا يوجد تاريخ سعر بعد.</p>;
  }
  const values = points.map((p) => p.price_minor);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = min * 0.95;
    max = max * 1.05;
  }
  const t0 = Date.parse(points[0].ts);
  const t1 = Date.parse(points[points.length - 1].ts);
  const span = Math.max(1, t1 - t0);
  const x = (ts) => pad.l + ((Date.parse(ts) - t0) / span) * (w - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.price_minor).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-xl border border-border bg-surface" role="img" aria-label="رسم بياني لتاريخ السعر">
      <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="#dfe6df" />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={h - pad.b} stroke="#dfe6df" />
      <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" fontSize="11" fill="#5b6b60">
        {formatEGP(Math.round(max))}
      </text>
      <text x={pad.l - 6} y={y(min) + 4} textAnchor="end" fontSize="11" fill="#5b6b60">
        {formatEGP(Math.round(min))}
      </text>
      <text x={pad.l} y={h - 8} fontSize="11" fill="#5b6b60">
        {formatDate(points[0].ts)}
      </text>
      <text x={w - pad.r} y={h - 8} textAnchor="end" fontSize="11" fill="#5b6b60">
        {formatDate(points[points.length - 1].ts)}
      </text>
      {points.length > 1 ? <path d={line} fill="none" stroke="#14532d" strokeWidth="2" /> : null}
      {points.map((p) => (
        <circle key={p.id} cx={x(p.ts).toFixed(1)} cy={y(p.price_minor).toFixed(1)} r="3.5" fill="#14532d">
          {/* <desc> بدل <title>: React 19 يعامل <title> كعنصر قابل للرفع
              فيُخرجه فارغاً في SSR فيختلف عن العميل (hydration #418).
              <desc> وصف SVG غير قابل للرفع فيُطابَق. */}
          <desc>
            {formatDate(p.ts)} — {formatEGP(p.price_minor)}
          </desc>
        </circle>
      ))}
    </svg>
  );
}
