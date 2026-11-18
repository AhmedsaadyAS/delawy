// تنسيق التاريخ والوقت: أسماء عربية وأرقام لاتينية (مثل الأسعار)،
// بتوقيت القاهرة صراحةً — نفس الناتج على السيرفر والمتصفح (بلا mismatch).
const dtf = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Cairo",
});

const df = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "medium",
  timeZone: "Africa/Cairo",
});

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dtf.format(d);
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : df.format(d);
}
