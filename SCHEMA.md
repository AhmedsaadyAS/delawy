# Schema v2 — قاعدة بيانات الويب أب (مسودة للاعتماد)

> مسودة فقط — تُعتمد قبل كتابة أي كود Worker. مبنية على قرارات `DECISIONS.md`
> ونتائج الـ Spike (Go على مسار WARP فقط). **المراجعة 2 (2026-11-18):** تاريخ
> الأسعار في D1 مش KV، جدول `poll_failures`، حالة `unproven`، رفض سجلات
> الأسلوب B عند الـ ingest، حد 3 منتجات للمستخدم، Resend للإيميل، الاكتشاف
> مؤجل.

## المبادئ (من القرارات المعتمدة)

1. **حماية كتابات D1:** مفيش `last_checked_at` بيتحدث مع كل فحص. الكتابة بس عند
   تغيّر السعر أو إطلاق تنبيه، + نبضة 24 ساعة للمنتجات النشطة بس.
2. **مصدر حداثة البيانات هو جدول `poll_runs`** (صف واحد لكل دفعة فحص) **+
   `poll_failures`** (صف لكل SKU فشل في الدفعة) — مش عمود زمني على كل منتج.
3. **تاريخ الأسعار في D1 (`price_points`)، مش KV:** الـ TTL بتاع KV بيتجدد عند
   الكتابة بس، فمنتج سعره ثابت 90 يوم يفقد تاريخه كله؛ وKV متسق بشكل نهائي
   (eventually consistent) ومفيش transaction يضمنه مع D1.
4. **HMAC على `timestamp.nonce.raw_body`** + جدول `ingest_nonces` ضد إعادة الإرسال.
5. **آلة حالات التنبيه:** `armed / triggered / paused / disabled` + هستيريسيس
   (التنبيه لا يُعاد إطلاقه إلا بعد رجوع السعر فوق الهدف + هامش).
6. **مفيش `password_hash`:** دخول بـ Telegram + OTP / Magic Link عبر `user_identities`.
7. **جودة العرض 5 حالات + EMA موزون زمنياً (30 يوم)** على نمط AzTracker — وحالة
   `unproven` للمنتجات اللي تاريخها أقل من 7 أيام.
8. **العمولة معيار ترجيح فقط** — الترتيب بجودة العرض أولاً.
9. **محرك اكتشاف منفصل عن محرك تتبع**، بقاعدة بيانات وتنبيهات مشتركة — **الاكتشاف
   مؤجل في الـ MVP** (لا جدول `discovery_candidates`).
10. **مؤجل:** `store_offers`، Web Push، LLM self-healing، فيسبوك داخل التطبيق، Jumia.
11. **سجلات الأسلوب B مرفوضة عند الـ ingest** — البحث بيرجع عرض مختلف عن العرض
    المثبّت في الـ PDP (مثال: N21961435A بسعر 1799 من البحث مقابل 1829 من الـ PDP).

## جداول D1

### `store_products` — المنتجات المتتبعة

| العمود | النوع | ملاحظة |
|---|---|---|
| `sku` | TEXT PK | SKU بتاع نون |
| `store` | TEXT | `'noon'` في الـ MVP |
| `slug` | TEXT | للروابط |
| `name` | TEXT | |
| `brand` | TEXT | |
| `category` | TEXT | |
| `url` | TEXT | رابط الـ PDP |
| `offer_code` | TEXT | كود العرض المثبّت (من الـ Spike) |
| `current_price` | REAL | يُحدَّث **بس عند تغيّر السعر** |
| `current_original_price` | REAL | |
| `current_seller` | TEXT | |
| `in_stock` | INTEGER | 0/1 |
| `price_updated_at` | TEXT | وقت آخر تغيّر سعر (مش وقت آخر فحص) |
| `ema_30d` | REAL | متوسط 30 يوم موزون زمنياً، يُحدَّث عند تغيّر السعر |
| `ema_updated_at` | TEXT | |
| `active` | INTEGER | 0/1 — المنتج لسه في نطاق التتبع؟ |
| `discovered_via` | TEXT | `spike` / `user_link` |
| `first_seen_at` | TEXT | |

### `price_points` — تاريخ الأسعار (نقطة لكل تغيّر سعر)

| العمود | النوع | ملاحظة |
|---|---|---|
| `sku` | TEXT | FK → store_products |
| `ts` | TEXT | وقت الرصد (ISO 8601 UTC) |
| `price` / `original_price` | REAL | |
| `seller` | TEXT | |
| `in_stock` | INTEGER | 0/1 |
| `run_id` | INTEGER | FK → poll_runs |
| PRIMARY KEY (`sku`, `ts`) | | |

- **الكتابة بس عند تغيّر السعر** (نفس قاعدة D1) — منتج سعره ثابت لا يكتب أي صف.
- ميزانية الكتابة: D1 المجاني 100,000 صف/يوم؛ تغيّرات الأسعار نادرة (في الـ Spike:
  4 من 50 SKU بس غيّروا سعرهم في 6 تشغيلات)، فالجدول ده رخيص جداً.
- الـ EMA وحالة الجودة والرسم البياني كلها تُحسب من هنا — لا KV إطلاقاً.

### `poll_runs` — سجل دفعات الفحص (نبضة الحداثة)

صف واحد لكل دفعة. حداثة أي SKU = آخر `price_points.ts` له، أو — لو مفيش نقطة
جديدة — آخر `poll_runs.finished_at` للـ `slice` اللي بيغطيه **بشرط مفيش صف
مقابل له في `poll_failures` في نفس الدفعة**.

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `store` | TEXT | |
| `slice` | TEXT | `warp-50` (كل الـ 50) أو `control-20` (أول 20) |
| `source` | TEXT | `github-actions` / `worker` / `manual` |
| `run_ref` | TEXT | رقم تشغيلة GitHub Actions أو معرّف الـ Worker |
| `started_at` / `finished_at` | TEXT | ISO 8601 UTC |
| `products_checked` | INTEGER | |
| `products_ok` | INTEGER | `parse_ok = true` |
| `products_failed` | INTEGER | |
| `akamai_count` | INTEGER | |
| `http_429_count` | INTEGER | |
| `http_403_count` | INTEGER | |
| `median_latency_ms` / `p95_latency_ms` | INTEGER | |

### `poll_failures` — أي SKU فشل في أي دفعة (وليه)

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `run_id` | INTEGER | FK → poll_runs |
| `sku` | TEXT | |
| `reason` | TEXT | `http_403` / `http_429` / `parse_fail` / `timeout` / `akamai_challenge` |
| `ts` | TEXT | |

بدون الجدول ده، `poll_runs` لوحده بيعتبر SKU فشل في الدفعة "حديثاً" لمجرد إن
الدفعة نفسها نجحت جزئياً.

### `ingest_nonces` — منع إعادة إرسال الـ Ingest

| العمود | النوع | ملاحظة |
|---|---|---|
| `nonce` | TEXT PK | UUID من المرسل |
| `ts` | TEXT | وقت الاستلام |
| `expires_at` | TEXT | `ts + 5 min` — تنظيف يومي بـ `DELETE` |

### `users` + `user_identities` — الحسابات (بدون باسورد)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- uuid
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE user_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,       -- 'telegram' | 'email'
  provider_id TEXT NOT NULL,    -- chat id أو الإيميل
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_id)
);
```

### `tracked_products` — ما يتابعه كل مستخدم (حد 3 منتجات، زي AzTracker)

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `user_id` | TEXT FK | |
| `sku` | TEXT FK → store_products | |
| `target_price` | REAL NULL | السعر المستهدف (فارغ = تنبيه ذكي بس) |
| `smart_target` | INTEGER | 0/1 — تنبيه عند أي عرض "ساخن" |
| `state` | TEXT | `armed` / `triggered` / `paused` / `disabled` |
| `created_at` | TEXT | |
| `triggered_at` | TEXT NULL | |
| `last_notified_at` | TEXT NULL | |
| UNIQUE (`user_id`, `sku`) | | |

الحد 3 منتجات/مستخدم يُفرض في منطق التطبيق (رفض إضافة رابع برسالة واضحة)،
مش بقيد قاعدة بيانات.

### `alerts_log` — سجل التنبيهات المُرسلة

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `user_id` / `sku` | TEXT | |
| `type` | TEXT | `price_drop` / `back_in_stock` |
| `old_price` / `new_price` | REAL | |
| `state` | TEXT | `sent` / `failed` |
| `channel` | TEXT | `telegram` / `email` / `in_app` |
| `sent_at` | TEXT | |

**الإيميل: Resend** (الباقة المجانية، أرقامها اتأكدت 2026-11-18 من صفحة الأسعار
ومراجعات نوفمبر 2026): **3,000 إيميل/شهر، بحد 100/يوم، سقف صلب بلا overage**
(الإيميل رقم 101 في اليوم بيفشل)، 3 دومينات، سجلات 30 يوم. السقف اليومي
بيتصفّر 00:00 UTC. عند 429: التنبيهات المتبقية تتجمع في **ملخص يومي واحد**
يتبعت تاني يوم ضمن الحصة، بدل ما تضيع.

### `coupons` — أكواد البرومو المختبرة (من الـ MVP)

| العمود | النوع | ملاحظة |
|---|---|---|
| `code` | TEXT PK | |
| `store` | TEXT | |
| `title` | TEXT | |
| `discount_pct` | REAL | |
| `verified_at` | TEXT | تاريخ آخر تأكيد شغال |
| `expires_at` | TEXT NULL | |
| `active` | INTEGER | |

## جودة العرض — 5 حالات (مشتقة عند القراءة، مش مخزنة)

نسبة النزول عن الـ EMA: `(ema_30d - current_price) / ema_30d`.
العتبة بتتدرج مع السعر على نمط AzTracker: **15% لمنتج ~100 جنيه**، **3% للابتوب
~100,000 جنيه** (استيفاء لوغاريتمي بينهما).

| الحالة | الشرط |
|---|---|
| `unproven` | تاريخ السعر أقل من 7 أيام — مفيش EMA موثوق لسه |
| `hot` | النزول ≥ العتبة |
| `good` | النزول ≥ نصف العتبة |
| `normal` | السعر تحت الـ EMA بس أقل من نصف العتبة |
| `bad` | السعر فوق الـ EMA |

**الخصم المشطوب مش هو الإشارة** — هو فلتر أولي بس (25–30%). الدليل من بيانات
الـ Spike (آخر سجل Strategy A لكل SKU، 42 منتج مخفّض من 50): الوسيط 33.4%،
الربع الأول 15.6%، الربع الثالث 44.4% — يعني فلتر 25% بيعدّي 29 منتج من 50
و30% بيعدّي 25، فهو مش انتقائي. ومثال حي: باور بانك Anker (N70120304V)
بـ 3,140 مقابل 10,000 مشطوب (-69%) — غالباً سعر أصلي منفوخ. **الإشارة الحقيقية
هي النزول عن الـ EMA** بعد ما يتجمع تاريخ.

## عقد `POST /api/ingest/noon`

نفس شكل سجل الـ Spike الموحّد — الفاتشر الحالي يبعت زي ما هو، **بس سجلات
الأسلوب A**. سجلات الأسلوب B بتترفض (400) لأنها بتقيس عرض مختلف.

**Headers:**
- `X-Timestamp`: وقت unix (مقبول ±5 دقائق)
- `X-Nonce`: UUID
- `X-Signature`: HMAC-SHA256 hex على `timestamp + "." + nonce + "." + raw_body`
  بمفتاح `INGEST_SECRET`

**Body (حد أقصى 100 سجل للطلب):**
```json
{
  "run": {
    "store": "noon",
    "slice": "warp-50",
    "source": "github-actions",
    "run_ref": "44211430129",
    "started_at": "2026-11-18T00:52:58Z",
    "finished_at": "2026-11-18T01:14:55Z"
  },
  "records": [
    {
      "ts": "2026-11-18T00:53:10Z",
      "sku": "N21961435A",
      "strategy": "A",
      "http_status": 200,
      "attempts": 1,
      "impersonate": "chrome",
      "akamai_challenge": false,
      "parse_ok": true,
      "parser_used": "json_ld",
      "price": 1799.0,
      "original_price": 2200.0,
      "seller": "Egypt Laptop",
      "in_stock": true,
      "offer_code": "…",
      "elapsed_ms": 5800,
      "error": null,
      "warp": true
    }
  ]
}
```

**المعالجة (على الخادم):**
1. تحقق من التوقيت (±5 دقائق) → `401` لو خارج النطاق.
2. تحقق من التوقيع → `401` لو غلط.
3. تحقق إن الـ nonce مش في `ingest_nonces` → `409` لو مكرر؛ خزّنه.
4. **ارفض أي سجل `strategy != "A"`** → `400` مع `reason: "strategy_b_rejected"`
   (في الـ Spike نص السجلات كانت B — الرفض ده بيقلل حجم الـ ingest للنص).
5. أدخل صف `poll_runs`.
6. لكل سجل `parse_ok`: لو المنتج جديد → أدخله؛ لو السعر/البائع/المخزون اتغير →
   حدّث `store_products` + أدخل نقطة `price_points` + حدّث `ema_30d` + قيّم
   التنبيهات؛ لو مفيش تغيّر → **مفيش أي كتابة**.
7. لكل سجل فاشل (`parse_ok = false` أو HTTP غير 200): أدخل صف `poll_failures`
   مع `reason` المناسب.
8. الرد: `{accepted, skipped, failed: [{sku, reason}], alerts_fired: [...]}` —
   قبول جزئي، والمرسل يعيد بس السجلات الفاشلة.

## الترحيل من بيانات الـ Spike (مرة واحدة)

- `store_products`: آخر سجل **Strategy A** لكل SKU من `spike/data/results.jsonl`.
- `price_points`: كل نقاط تغيّر السعر من سجلات A بس (سجلات B مستبعدة تماماً).
- `poll_runs`: التشغيلات المعروفة بأعدادها (43889479753، 43981543443، 44040433960،
  44138067464، 44211430129، + التشغيلة السادسة 2026-11-18 08:19–08:39Z).
- `poll_failures`: من سجلات الـ control الفاشلة (HTTP 403).
- سكربت ترحيل لمرة واحدة — مش جزء من كود الـ MVP.

## المجموعة الأولى للتتبع (قرار 2026-11-18)

الـ 50 SKU بتوع الـ Spike بعد تحديث 2026-11-18: **12 ملحق اتشالوا** (5 أربطة
ساعات، 4 جرابات موبايل، شاحن لاسلكي، ستاند موبايل، ريموت عرض) **ودخل مكانهم
6 موبايلات + 6 لابتوبات** (Galaxy A36، Infinix Hot 60 Pro+ / Hot 70 AI،
realme C100i، Honor X5c Plus، ITEL A200 Plus؛ Dell Vostro 3515، HP Envy 14،
Lenovo IdeaPad Slim 3، HP Victus 15، MacBook Air M4، ASUS TUF F16).
التوزيع الجديد: <500: 4، 500–3000: 12، 3000–15000: 19، >15000: 15.
الـ 12 الجداد **يظهروا `unproven`** لحد ما يتجمع لهم 7 أيام تاريخ — وده سبب
تاني إن الـ workflow يفضل شغال كل 6 ساعات بدل ما يتعطل: بيبني الـ EMA وبيعالج
مشكلة البداية الباردة.

## القرارات المعتمدة (2026-11-18)

1. المجموعة الأولى: الـ 50 SKU بعد التحديث (أعلاه).
2. **حد التتبع: 3 منتجات/مستخدم** (زي AzTracker).
3. **مزود الإيميل: Resend** — مجاني 3,000/شهر بحد 100/يوم، و429 يتعالج بملخص يومي.
4. **محرك الاكتشاف مؤجل** — مفيش جدول `discovery_candidates` في الـ MVP.
5. **الإشارة الأساسية: النزول عن الـ EMA**، والخصم المشطوب 25–30% فلتر أولي بس.

## ملاحظات التنفيذ — Web Worker v0.1.0 (2026-11-18)

التنفيذ الفعلي في `apps/web-worker/` طبّق المخطط ده مع التحسينات التالية
(موثقة هنا عشان الملف يفضل صادقاً مع الكود):

1. **معرّف داخلي `id INTEGER`** للمنتج، وهوية المتجر `UNIQUE(store, external_id)`
   (الـ `external_id` هو SKU نون) — بدل `sku TEXT` كمفتاح أساسي.
2. **الأموال عدد صحيح بالقروش**: `price_minor` (السعر × 100) و`currency = 'EGP'`،
   بدل REAL — التحويل دقيق عبر نصوص (`57129.95` ← `5712995` بالظبط).
3. **`last_successful_check_at` لكل منتج** يُحدَّث مع كل قراءة ناجحة — تبسيط
   متعمد للنسخة الصغيرة بدل استنتاج الحداثة من `poll_runs` + `poll_failures`
   (قرارات `DECISIONS.md` §2). `price_updated_at` منفصل تماماً ولا يُعرض أبداً
   كوقت آخر فحص.
4. **الـ EMA يُحسب عند القراءة** من `price_points` (مش مخزّن) — لا `ema_30d`
   ولا `ema_updated_at` في `store_products`.
5. **صفوف `poll_runs` مُعاد بناؤها** بتجميع السجلات زمنياً (فجوة > 30 دقيقة =
   دفعة جديدة) لأن `results.jsonl` لا يحمل أرقام تشغيلات GitHub.
6. **الاستيراد**: `scripts/seed.mjs` يقرأ `spike/skus.csv` +
   `spike/data/results.jsonl` + `apps/web-worker/seed/removed-skus.csv`
   (بيانات الـ 12 SKU اللي خرجوا من القائمة — نشاطهم 0). سجلات الأسلوب B
   مرفوضة، والـ control مستبعد، ولا سعر قديم يغطي على أحدث.
7. لا KV إطلاقاً، ولا نشر ولا migration على remote — التشغيل محلي فقط حتى
   موافقة صريحة.
