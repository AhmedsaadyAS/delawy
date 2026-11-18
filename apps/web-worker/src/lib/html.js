// Server-rendered HTML (Arabic, RTL, Tailwind via CDN). No client JS needed
// except the Tailwind CDN script; the price chart is inline SVG.

import { formatEGP, discountPct, fromMinor } from './money.js';
import { DEAL_LABELS } from './ema.js';

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BADGE = {
  unproven: 'bg-gray-200 text-gray-700',
  hot: 'bg-red-600 text-white',
  good: 'bg-green-600 text-white',
  normal: 'bg-yellow-100 text-yellow-800',
  bad: 'bg-gray-100 text-gray-500',
};

function stockLabel(inStock) {
  if (inStock === 1) return 'متوفر';
  if (inStock === 0) return 'غير متوفر';
  return 'غير معروف';
}

function brandCategory(p) {
  return [p.brand, p.category].filter(Boolean).join(' · ');
}

/** Product image, or a same-size placeholder when no image was captured. */
function productImage(p, cls) {
  if (p.image_url) {
    return `<img src="${esc(p.image_url)}" alt="" loading="lazy" class="${cls} bg-white">`;
  }
  return `<div class="${cls} bg-gray-100 flex items-center justify-center text-gray-400 text-sm">لا توجد صورة</div>`;
}

export function dealBadge(state) {
  const cls = BADGE[state] || BADGE.unproven;
  return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-bold ${cls}">${esc(DEAL_LABELS[state] || state)}</span>`;
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ديلاوي</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 text-gray-900">
<header class="bg-white shadow">
  <div class="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
    <a href="/" class="text-2xl font-black text-red-600">ديلاوي</a>
    <span class="text-sm text-gray-500">عروض نون مصر — أسعار حقيقية من المتابعة</span>
  </div>
</header>
<main class="mx-auto max-w-5xl px-4 py-6">
${body}
</main>
<footer class="mx-auto max-w-5xl px-4 pb-8 text-center text-xs text-gray-400">
  نسخة تجريبية — الأسعار من متابعة نون (Spike) وليست عرضاً مباشراً من المتجر. تحقق من السعر على صفحة المنتج قبل الشراء.
</footer>
</body>
</html>`;
}

export function unverifiedBadge() {
  return '<span class="inline-block rounded-full px-2 py-0.5 text-xs font-bold bg-amber-100 text-amber-800">سعر أولي — لم يُتحقق منه</span>';
}

export function productCard(p, deal) {
  const pct = discountPct(p.current_price_minor, p.current_original_price_minor);
  return `<a href="/products/${p.id}" class="block bg-white rounded-xl shadow p-4 hover:shadow-md transition">
  ${productImage(p, 'w-full h-44 object-contain rounded-lg mb-3')}
  <div class="flex items-start justify-between gap-2">
    <h2 class="font-bold leading-snug">${esc(p.name)}</h2>
    ${deal.verified ? dealBadge(deal.state) : unverifiedBadge()}
  </div>
  <p class="text-sm text-gray-500 mt-1">${esc(brandCategory(p))}</p>
  <div class="mt-3 flex items-end gap-2">
    <span class="text-xl font-black text-red-600">${formatEGP(p.current_price_minor)}</span>
    ${p.current_original_price_minor && pct !== null ? `<span class="text-sm text-gray-400 line-through">${formatEGP(p.current_original_price_minor)}</span><span class="text-sm font-bold text-green-600">-${pct}%</span>` : ''}
  </div>
  <p class="text-sm text-gray-500 mt-1">البائع: ${esc(p.current_seller || '—')} · ${stockLabel(p.in_stock)}</p>
  <p class="text-xs text-gray-400 mt-1">آخر فحص ناجح: ${esc(p.last_successful_check_at || '—')}</p>
</a>`;
}

export function listPage(products, deals, meta) {
  const cards = products.map((p, i) => productCard(p, deals[i])).join('\n');
  const prev =
    meta.page > 1
      ? `<a href="/?page=${meta.page - 1}" class="px-3 py-1 bg-white rounded shadow">السابق</a>`
      : '';
  const next =
    meta.page < meta.total_pages
      ? `<a href="/?page=${meta.page + 1}" class="px-3 py-1 bg-white rounded shadow">التالي</a>`
      : '';
  return layout(
    'المنتجات',
    `<h1 class="text-2xl font-black mb-1">منتجات نون المتتبعة</h1>
<p class="text-gray-500 mb-4">${meta.total} منتج نشط — الأسعار بالجنيه المصري، وتاريخ كل منتج من المتابعة الفعلية.</p>
<div class="grid gap-4 md:grid-cols-2">${cards || '<p class="text-gray-500">لا توجد منتجات بعد.</p>'}</div>
<div class="mt-6 flex items-center justify-center gap-3">${prev}<span class="text-sm text-gray-500">صفحة ${meta.page} من ${meta.total_pages}</span>${next}</div>`,
  );
}

/** Minimal SVG line chart from points [{ts, price_minor}]. */
export function priceChart(points) {
  const w = 720;
  const h = 220;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  if (!points || points.length === 0) {
    return '<p class="text-gray-500">لا يوجد تاريخ سعر بعد.</p>';
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
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.price_minor).toFixed(1)}`)
    .join(' ');
  const dots = points
    .map(
      (p) =>
        `<circle cx="${x(p.ts).toFixed(1)}" cy="${y(p.price_minor).toFixed(1)}" r="3.5" fill="#dc2626"><title>${esc(p.ts)} — ${formatEGP(p.price_minor)}</title></circle>`,
    )
    .join('');
  const fmtDate = (ts) =>
    new Date(ts).toISOString().slice(0, 10);
  return `<svg viewBox="0 0 ${w} ${h}" class="w-full bg-white rounded-xl shadow" role="img" aria-label="رسم بياني لتاريخ السعر">
  <line x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}" stroke="#e5e7eb"/>
  <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${h - pad.b}" stroke="#e5e7eb"/>
  <text x="${pad.l - 6}" y="${y(max) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${formatEGP(Math.round(max))}</text>
  <text x="${pad.l - 6}" y="${y(min) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${formatEGP(Math.round(min))}</text>
  <text x="${pad.l}" y="${h - 8}" font-size="11" fill="#6b7280">${fmtDate(points[0].ts)}</text>
  <text x="${w - pad.r}" y="${h - 8}" text-anchor="end" font-size="11" fill="#6b7280">${fmtDate(points[points.length - 1].ts)}</text>
  <path d="${line}" fill="none" stroke="#dc2626" stroke-width="2"/>
  ${dots}
</svg>`;
}

export function detailPage(p, deal, points, days) {
  const pct = discountPct(p.current_price_minor, p.current_original_price_minor);
  const minPoint = points.length
    ? points.reduce((a, b) => (b.price_minor < a.price_minor ? b : a), points[0])
    : null;
  const maxPoint = points.length
    ? points.reduce((a, b) => (b.price_minor > a.price_minor ? b : a), points[0])
    : null;
  const dayLinks = [7, 30, 90]
    .map(
      (d) =>
        `<a href="/products/${p.id}?days=${d}" class="px-3 py-1 rounded ${d === days ? 'bg-red-600 text-white' : 'bg-white shadow'} text-sm">${d} يوم</a>`,
    )
    .join(' ');
  // Unverified products (price from the sku list only): no min/max/EMA claims.
  const minMax = deal.verified && minPoint ? formatEGP(minPoint.price_minor) : '—';
  const maxMax = deal.verified && maxPoint ? formatEGP(maxPoint.price_minor) : '—';
  const emaNote = !deal.verified
    ? '<div class="text-sm text-gray-400">لا يوجد متوسط — المنتج لم يُفحص بعد</div>'
    : deal.drop_pct !== null
      ? `<div class="text-sm text-green-600">أقل من المتوسط بنسبة ${deal.drop_pct}%</div>`
      : '<div class="text-sm text-gray-400">تاريخ أقل من 7 أيام — غير مثبَت</div>';
  const priceTimeLabel = deal.verified ? 'آخر تغيّر سعر' : 'سعر القائمة بتاريخ';
  const rows = [...points].reverse()
    .map(
      (pt) => `<tr class="border-t">
      <td class="py-2 px-2">${esc(pt.ts)}</td>
      <td class="py-2 px-2 font-bold">${formatEGP(pt.price_minor)}</td>
      <td class="py-2 px-2">${pt.original_price_minor ? formatEGP(pt.original_price_minor) : '—'}</td>
      <td class="py-2 px-2">${esc(pt.seller || '—')}</td>
      <td class="py-2 px-2">${stockLabel(pt.in_stock)}</td>
    </tr>`,
    )
    .join('');
  return layout(
    p.name,
    `<a href="/" class="text-sm text-red-600">← كل المنتجات</a>
<h1 class="text-2xl font-black mt-2 leading-snug">${esc(p.name)}</h1>
<p class="text-gray-500 mt-1">${esc(brandCategory(p))}</p>
<div class="mt-4 bg-white rounded-xl shadow p-4 flex flex-wrap items-center gap-4">
  ${productImage(p, 'w-44 h-44 object-contain rounded-lg shrink-0')}
  <div>
    <div class="text-3xl font-black text-red-600">${formatEGP(p.current_price_minor)}</div>
    ${p.current_original_price_minor && pct !== null ? `<div class="text-gray-400 line-through">${formatEGP(p.current_original_price_minor)} <span class="text-green-600 font-bold no-underline">-${pct}%</span></div>` : ''}
  </div>
  ${deal.verified ? dealBadge(deal.state) : unverifiedBadge()}
  <div class="text-sm text-gray-500">
    <div>البائع: ${esc(p.current_seller || '—')}</div>
    <div>${stockLabel(p.in_stock)}</div>
    <div>آخر فحص ناجح: ${esc(p.last_successful_check_at || '—')}</div>
    <div>${priceTimeLabel}: ${esc(p.price_updated_at || '—')}</div>
  </div>
  ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="mr-auto px-4 py-2 bg-red-600 text-white rounded-lg font-bold">اشترِ من نون</a>` : ''}
</div>
${deal.verified ? '' : '<div class="mt-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm font-bold">سعر أولي من القائمة — لم يُتحقق منه بعد. هذا السعر من قائمة المنتجات وقت الإعداد، ولم يُفحص بعد من صفحة المنتج على نون.</div>'}
<div class="mt-4 grid gap-4 md:grid-cols-3 text-center">
  <div class="bg-white rounded-xl shadow p-3"><div class="text-xs text-gray-400">أقل سعر (${days} يوم)</div><div class="font-black text-lg">${minMax}</div></div>
  <div class="bg-white rounded-xl shadow p-3"><div class="text-xs text-gray-400">أعلى سعر (${days} يوم)</div><div class="font-black text-lg">${maxMax}</div></div>
  <div class="bg-white rounded-xl shadow p-3"><div class="text-xs text-gray-400">متوسط 30 يوم (EMA)</div><div class="font-black text-lg">${deal.ema_minor !== null ? formatEGP(deal.ema_minor) : '—'}</div>${emaNote}</div>
</div>
<div class="mt-6 flex items-center gap-2">${dayLinks}<span class="text-sm text-gray-500">${points.length} نقطة</span></div>
<div class="mt-2">${priceChart(points)}</div>
<div class="mt-6 bg-white rounded-xl shadow overflow-x-auto">
<table class="w-full text-sm">
<thead><tr class="text-right text-gray-400"><th class="py-2 px-2">الوقت</th><th class="py-2 px-2">السعر</th><th class="py-2 px-2">قبل الخصم</th><th class="py-2 px-2">البائع</th><th class="py-2 px-2">التوفر</th></tr></thead>
<tbody>${rows || '<tr><td class="py-4 px-2 text-gray-500" colspan="5">لا يوجد تاريخ سعر بعد.</td></tr>'}</tbody>
</table>
</div>
<p class="text-xs text-gray-400 mt-4">الأسعار من متابعة نون الفعلية (Spike) — ليست عرضاً حياً من المتجر. SKU: ${esc(p.external_id)}</p>`,
  );
}

export function notFoundPage(message) {
  return layout('غير موجود', `<h1 class="text-2xl font-black">غير موجود</h1><p class="text-gray-500 mt-2">${esc(message)}</p><a href="/" class="text-red-600">← الرجوع للمنتجات</a>`);
}
