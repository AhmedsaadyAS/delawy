# ديلاوي — ويب أب تجريبي (Cloudflare Workers + D1)

ويب أب تجريبي يعرض منتجات نون مصر وبيانات أسعارها الحقيقية من الـ Spike، مع
صفحة لكل منتج وتاريخ سعره. مسار قراءة فقط: قاعدة بيانات ← API ← صفحات
React Router v8 SSR على Cloudflare Workers (قرار D21، 2026-11-18 — غيّر
واجهة v0.1.0 اللي كانت HTML مولّد يدوياً من الـ Worker؛ العرض القديم
`src/index.js` + `src/lib/html.js` اتحذف بعد إثبات الشريحة الجديدة محلياً).
JavaScript بلا TypeScript، والباك إند (Workers + D1 + migrations + seed +
scraper) بلا إعادة كتابة.

## خطة الملفات

```
apps/web-worker/
  wrangler.toml            إعداد Wrangler + ربط D1 باسم DB (placeholder محلي)؛ main = workers/app.js
  vite.config.js           إضافات Vite: cloudflare (بيئة ssr) + tailwindcss + reactRouter
  react-router.config.js   { ssr: true } (React Router v8 — بلا future flags)
  workers/app.js           نقطة دخول الـ Worker (قالب Cloudflare الرسمي لـ React Router)
  app/                     واجهة React: root.jsx + routes/ (‏/ و products/:id و api/*) + components/ + lib/
  app/app.css              Tailwind v4 مبني ضمن المشروع (‏@theme: أخضر غامق #14532d، خط IBM Plex Sans Arabic)
  src/lib/db.js            استعلامات D1 لمسار القراءة (مع فلاتر q/category/stock قبل الترقيم)
  src/lib/money.js         الأموال كعدد صحيح بالقروش (minor units) + تنسيق EGP
  src/lib/ema.js           متوسط 30 يوم موزون زمنياً + حالات جودة العرض
  src/lib/pagination.js    تحليل ?page=&limit= و ?days=
  src/lib/product-json.js  شكل JSON المنتج المشترك بين الـ API والصفحات
  migrations/0001_init.sql الجداول الأربعة لهذا المسار فقط
  migrations/0002_add_image_url.sql عمود image_url في store_products
  scripts/seed-lib.mjs     منطق الاستيراد (pure — قابل للاختبار)
  scripts/seed.mjs         CLI يبني SQL الاستيراد + الملخص
  scripts/smoke.mjs        فحص الـ endpoints على خادم dev شغال (يقبل baseUrl كوسيط)
  seed/removed-skus.csv    بيانات SKUs خرجت من skus.csv (غير نشطة)
  seed/sku-images.json     صور المنتجات (sku -> رابط Noon CDN) — ملء لمرة واحدة
  tests/                   اختبارات node:test
  visual-review/           أدوات مراجعة بصرية محلية فقط (Playwright + Chrome للاختبار) — ليست جزءاً من التطبيق
```

ملفات مولّدة (لا تُعدَّل يدوياً ولا تُرفع): `build/` (الـ Worker + أصول العميل
بعد `npm run build`) و`.react-router/` (أنواع ومخططات مؤقتة). **ملاحظة:**
`npm run build` بيمسح `build/` كاملاً — ومنه حالة D1 المحلية الخاصة
بالـ Worker المبني (`build/server/.wrangler/state`)، فبعد كل بناء لازم
تعيد `migrate` + `seed` على إعداد `build/server/wrangler.json` قبل اختبار
الـ Worker المبني (انظر `dev:worker` تحت).

## التشغيل محلياً

```bash
cd apps/web-worker
npm install
npm test                    # اختبارات الوحدة (31 اختباراً)
npm run migrate:local       # تطبيق migration على D1 المحلية (لخادم React Router)
npm run seed                # استيراد بيانات Spike + ملخص (قابل لإعادة التشغيل)
npm run dev                 # خادم React Router على http://localhost:5173
npm run build               # بناء الـ Worker + الأصول في build/
# اختبار الـ Worker المبني (بعد كل build، أعد التهيئة لأن البناء يمسح حالته):
npx wrangler d1 migrations apply DB --local --config build/server/wrangler.json
npx wrangler d1 execute DB --local --file=.dev/seed.sql --config build/server/wrangler.json
npm run dev:worker          # خادم الـ Worker المبني على http://localhost:8787
npm run smoke               # فحص الـ endpoints (الافتراضي 8787؛ أو: node scripts/smoke.mjs http://localhost:5173)
```

## الـ API

| المسار | الوصف |
|---|---|
| `GET /api/health` | `ok` + عدد المنتجات والنقاط + آخر فحص ناجح |
| `GET /api/products?page=&limit=&q=&category=&stock=` | قائمة المنتجات النشطة (limit افتراضي 20، أقصى 100) — الفلاتر تُطبَّق في SQL قبل الترقيم |
| `GET /api/products/:id` | تفاصيل منتج + EMA + حالة العرض + عدد النقاط |
| `GET /api/products/:id/history?days=7\|30\|90` | نقاط تاريخ السعر (افتراضي 30 يوم، limit أقصى 1000) |

الصفحات: `/` قائمة المنتجات (بحث `?q=` + فلتر فئة `?category=` + فلتر توفر
`?stock=1|0` — الفلاتر في الرابط وتُطبَّق قبل الترقيم)، `/products/:id`
صفحة منتج مع رسم بياني لتاريخ السعر وجدول النقاط وأقل/أعلى سعر وEMA
(روابط `?days=7|30|90`).

## إصلاحات من المراجعة البصرية (2026-11-18)

- **ترطيب React (hydration #418):** `<title>` داخل دوائر الـ SVG كان
  يخرج فارغاً في SSR (React 19 يعامله كعنصر قابل للرفع) فيختلف عن العميل
  — استُبدل بـ `<desc>` (نفس الوصف، غير قابل للرفع) فتطابقت الصفحات.
- **تمرير أفقي بعرض 360px:** البطاقة (عنصر grid) كانت أعرض من خليتها
  (سطر `truncate` للعلامة والفئة بلا التفاف يرفع الـ min-content) — أُضيف
  `min-w-0` للبطاقة فصارت 360px بلا تجاوز.
- **404 الـ favicon:** أيقونة SVG مضمّنة (data URI) في `root.jsx` بدل
  طلب `/favicon.ico` غير الموجود.

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

## صور المنتجات

صورة المنتج جاية من صفحة نون نفسها: الـ fetcher بيستخرج أول رابط من حقل
`image` في JSON-LD (قائمة روابط `f.nooncdn.com`)، و`og:image` بديل لو
JSON-LD مفيهوش صورة. الـ Worker بيخزن الرابط بس — مبيحمّلش الصورة ولا
يعيد استضافتها، والصفحة بتعرضها مباشرة من CDN نون (`loading="lazy"`).

- سجل الـ Spike فيه حقل `image_url` (أسلوب A بس) — والـ seed بياخد أحدث
  صورة غير فارغة من السجلات، ولو مفيش بياخد من `seed/sku-images.json`
  (ملء لمرة واحدة بسكربت `spike/backfill_images.py` — بيقرأ الـ PDP مرة
  لكل SKU وبيكتب الملف ده بس، ومبيكتبش في `results.jsonl` أبداً).
- لو مفيش صورة من أي مصدر، البطاقة وصفحة المنتج بيعرضوا خانة «لا توجد
  صورة» بنفس المقاس بدل صورة مكسورة.
- الـ API بيحمل `image_url` في كل منتج، والـ smoke بيتأكد أن فيه منتجات
  بصور وأن صفحة القائمة فيها وسوم `<img>`.

`store_products.last_successful_check_at` يتحدث مع كل قراءة ناجحة للمنتج.
ده تبسيط متعمد للنسخة الصغيرة بدل تصميم استنتاج حداثة معقد من `poll_runs` +
`poll_failures` — وسهل صحيح: غياب صف فشل **لا** يعني أن المنتج اتفحص،
والحداثة تُستنتج فقط من قراءات المنتج نفسه. و`price_updated_at` (وقت آخر
تغيّر سعر) منفصل تماماً ولا يُعرض أبداً كوقت آخر فحص.

في الـ ingest الحي مستقبلاً، التحديث ده كتابة إضافية لكل فحص — مقبول الآن،
ويُراجَع لما يكبر عدد المنتجات (قرارات D1 في `DECISIONS.md` §2).

## منتجات لم تُفحص بعد (سعر أولي من القائمة)

المنتج اللي سعره من `sku_list` بس (نقطة `source='sku_list'`، و
`last_successful_check_at` فارغ) يتعرض كده — في الـ API وفي الصفحة:

- شارة كهرمانية **«سعر أولي — لم يُتحقق منه»** بدل شارة جودة العرض.
- لافتة في صفحة المنتج: «سعر أولي من القائمة — لم يُتحقق منه بعد».
- **لا EMA ولا أقل/أعلى سعر** — الخانات دي بتظهر «—» (مفيش متوسط 30 يوم
  يُدَّعى).
- «آخر فحص ناجح» يظهر «—» — مفيش قيمة وهمية.
- وقت السعر يتعرض بعنوان **«سعر القائمة بتاريخ»** مش «آخر تغيّر سعر»،
  عشان وقت الفحص ووقت تغير السعر مفصولين دايماً.

الـ API بيحمل الحقلين `verified` و`price_source` (`spike_run` / `sku_list`)
عشان أي مستهلك تاني يطبق نفس القواعد.

## Staging (نشر تجريبي منفصل)

بيئة منفصلة تماماً عن الإعداد المحلي:

- Worker باسم **`delawy-staging`** (قسم `[env.staging]` في `wrangler.toml`).
- قاعدة D1 منفصلة باسم **`delawy-staging-db`** — مفيش أي أمر بعيد
  يستهدف القاعدة المحلية أو أي قاعدة تانية بالخطأ، لأن كل سكربت بعيد
  بيحمل `--env staging --remote` صراحةً.
- **مفيش tokens أو secrets في الملفات أو الـ commits** — الدخول لـ
  Cloudflare بيتم بتوكن API محفوظ في الموصل `custom.cloudflare`، وكل أوامر
  wrangler البعيدة بتتشغل عن طريق `wrangler-cloudflare.py` (بيجيب بديل
  `hsurr:*` من المخزن الآمن وبيحطه في `CLOUDFLARE_API_TOKEN`) — التوكن
  الحقيقي مبيظهرش في الشات ولا في الملفات أبداً. مسار `wrangler login`
  (OAuth) اتجرّب واتساب لأن تسجيل الدخول من المتصفح تعطّل.
- مفيش دومين مخصص — الرابط بيكون `*.workers.dev` اللي Cloudflare بتديه.
  الـ subdomain بتاع الحساب هو `delawy`، والرابط الحي:
  `https://delawy-staging.delawy.workers.dev` (اتنشر واتأكد شغال
  2026-11-18).

```bash
# الخطوات دي اتنفذت على staging 2026-11-18 (بعد موافقة صريحة) — الترتيب:
# التوكن اتحفظ في الموصل، وبعدين:
wrangler d1 create delawy-staging-db             # إنشاء القاعدة، وبيطبع database_id
# حط الـ database_id في wrangler.toml تحت [env.staging] بدل الـ placeholder
npm run migrate:staging                          # تطبيق 0001 على delawy-staging-db
npm run seed:staging                             # نفس ملخص الاستيراد المحلي، على القاعدة البعيدة
npm run deploy:staging                           # نشر delawy-staging
```

القاعدة البعيدة تستقبل **قراءات Strategy A الناجحة عبر WARP فقط**
(`parse_ok=true` وHTTP 200 و`warp=true`) — نفس شروط الاستيراد المحلي،
وقابلة لإعادة التشغيل بدون تكرار. وملخص البيانات (62 منتج، 69 نقطة، 6 دفعات،
0 فشل — من 600 سجل دخلت، 300 أسلوب B اترفضوا) يُعرض **قبل** التطبيق.
ملفات HTML الفاشلة وبيانات خاصة مفيش لها أي طريق للاستيراد أصلاً: الـ seed
بيقرأ `spike/skus.csv` و`spike/data/results.jsonl` و`seed/removed-skus.csv`
وبس.

**قاعدة أمان:** متشغّلش أبداً `wrangler deploy` أو `d1 execute` أو
`d1 migrations apply` من غير `--env staging --remote` (أو `--local`) —
الإعداد الافتراضي فيه placeholder ومفيش قاعدة remote حقيقية مربوطة بيه.

## ما لم يُنفَّذ (عمداً)

- النشر على staging اتنفذ 2026-11-18 (الرابط فوق) — أي نشر أو migration
  تاني على قاعدة remote يحتاج موافقة صريحة برضه. شريحة React دي محلية
  فقط ولم تُنشر ولم تُرفع.
- العرض القديم (HTML مولّد يدوياً) اتحذف 2026-11-18 بعد إثبات شريحة React
  محلياً (build + 31 اختبار وحدة + smoke 10/10 على الـ Worker المبني +
  مراجعة بصرية 360/390/1280 بلا تمرير أفقي وبلا أخطاء ترطيب).
- لا نقل لـ scraper بايثون إلى الـ Worker — يظل منفصلاً.
- لا KV لتاريخ الأسعار — التاريخ في D1 (`price_points`).
- لا حسابات ولا تنبيهات ولا أكواد خصم في هذه المرحلة.
- صفحة نتائج الـ Spike (`public/index.html`) لم تُمس — تظل كما هي.
