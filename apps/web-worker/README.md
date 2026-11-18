# ديلاوي — ويب أب تجريبي (Cloudflare Workers + D1)

ويب أب تجريبي يعرض منتجات نون مصر وبيانات أسعارها الحقيقية من الـ Spike، مع
صفحة لكل منتج وتاريخ سعره. مسار قراءة فقط: قاعدة بيانات ← API ← صفحات
HTML/Tailwind مولّدة من الـ Worker.

## خطة الملفات

```
apps/web-worker/
  wrangler.toml            إعداد Wrangler + ربط D1 باسم DB (placeholder محلي)
  package.json             سكربتات التشغيل والاختبار
  src/index.js             الـ Worker: التوجيه + API + صفحات HTML
  src/lib/db.js            استعلامات D1 لمسار القراءة
  src/lib/money.js         الأموال كعدد صحيح بالقروش (minor units) + تنسيق EGP
  src/lib/ema.js           متوسط 30 يوم موزون زمنياً + حالات جودة العرض
  src/lib/pagination.js    تحليل ?page=&limit= و ?days=
  src/lib/html.js          صفحات HTML (عربي RTL) + رسم بياني SVG لتاريخ السعر
  migrations/0001_init.sql الجداول الأربعة لهذا المسار فقط
  scripts/seed-lib.mjs     منطق الاستيراد (pure — قابل للاختبار)
  scripts/seed.mjs         CLI يبني SQL الاستيراد + الملخص
  scripts/smoke.mjs        فحص الـ endpoints على خادم dev شغال
  seed/removed-skus.csv    بيانات SKUs خرجت من skus.csv (غير نشطة)
  tests/                   اختبارات node:test
```

## التشغيل محلياً

```bash
cd apps/web-worker
npm install
npm test                    # اختبارات الوحدة
npm run migrate:local       # تطبيق migration على D1 المحلية
npm run seed                # استيراد بيانات Spike + ملخص (قابل لإعادة التشغيل)
npm run dev                 # خادم محلي على http://localhost:8787
npm run smoke               # فحص الـ endpoints (يحتاج dev شغال)
```

## الـ API

| المسار | الوصف |
|---|---|
| `GET /api/health` | `ok` + عدد المنتجات والنقاط + آخر فحص ناجح |
| `GET /api/products?page=&limit=` | قائمة المنتجات النشطة (limit افتراضي 20، أقصى 100) |
| `GET /api/products/:id` | تفاصيل منتج + EMA + حالة العرض + عدد النقاط |
| `GET /api/products/:id/history?days=7\|30\|90` | نقاط تاريخ السعر (افتراضي 30 يوم، limit أقصى 1000) |

الصفحات: `/` قائمة المنتجات، `/products/:id` صفحة منتج مع رسم بياني لتاريخ
السعر وجدول النقاط وأقل/أعلى سعر وEMA.

## قاعدة البيانات (migration 0001)

الجداول لهذا المسار فقط: `store_products` و`price_points` و`poll_runs`
و`poll_failures`. لا حسابات ولا تنبيهات ولا كوبونات الآن.

- هوية المنتج داخل المتجر: `UNIQUE(store, external_id)`، والمعرّف الداخلي
  `id INTEGER` هو المستخدم في الـ API والروابط.
- الأموال عدد صحيح بالقروش: `price_minor` (سعر × 100)، والعملة `currency = 'EGP'`.
- نقطة أولى لكل منتج حتى لو لم يتغير سعره؛ ونقطة جديدة عند تغيّر السعر أو
  البائع أو التوفر. نقاط `source='sku_list'` جاية من سعر القائمة في
  `skus.csv` (للمنتجات اللي لسه متقرأتش ولا مرة) — مش مخترعة.

## الاستيراد (seed)

يقرأ `spike/skus.csv` (البيانات التعريفية) و`spike/data/results.jsonl`
(قراءات الأسعار)، ويخرج ملخصاً: المنتجات والنقاط والمرفوضات وأسبابها.

- **Strategy A فقط**، `parse_ok=true` وHTTP 200 فقط، و`warp=true` فقط —
  بيانات الـ control مستبعدة من مصدر الأسعار.
- لا سعر قديم يغطي على سعر أحدث: السجلات تُطبق بترتيب الوقت، والحالة الحالية
  دائماً من أحدث سجل.
- المنتجات التاريخية اللي خرجت من `skus.csv` محفوظة (من `seed/removed-skus.csv`)
  لكن `active = 0`، فلا تظهر في قائمة البداية.
- صفوف `poll_runs` مُعاد بناؤها بتجميع السجلات زمنياً (فجوة > 30 دقيقة = دفعة
  جديدة) لأن `results.jsonl` لا يحمل أرقام تشغيلات GitHub.
- إعادة التشغيل آمنة: upsert بحارس عدم التراجع، و`INSERT OR IGNORE` للنقاط
  والفشل، و`ON CONFLICT DO NOTHING` للدفعات.

## سياسة الحداثة (تبسيط موثّق)

`store_products.last_successful_check_at` يتحدث مع كل قراءة ناجحة للمنتج.
ده تبسيط متعمد للنسخة الصغيرة بدل تصميم استنتاج حداثة معقد من `poll_runs` +
`poll_failures` — وسهل صحيح: غياب صف فشل **لا** يعني أن المنتج اتفحص،
والحداثة تُستنتج فقط من قراءات المنتج نفسه. و`price_updated_at` (وقت آخر
تغيّر سعر) منفصل تماماً ولا يُعرض أبداً كوقت آخر فحص.

في الـ ingest الحي مستقبلاً، التحديث ده كتابة إضافية لكل فحص — مقبول الآن،
ويُراجَع لما يكبر عدد المنتجات (قرارات D1 في `DECISIONS.md` §2).

## ما لم يُنفَّذ (عمداً)

- **لا نشر ولا migration على قاعدة remote** — يحتاج موافقة صريحة + `database_id`
  حقيقي (الحالي placeholder للتشغيل المحلي فقط).
- لا نقل لـ scraper بايثون إلى الـ Worker — يظل منفصلاً.
- لا KV لتاريخ الأسعار — التاريخ في D1 (`price_points`).
- لا حسابات ولا تنبيهات ولا أكواد خصم في هذه المرحلة.
- صفحة نتائج الـ Spike (`public/index.html`) لم تُمس — تظل كما هي.
