# Schema v2 — قاعدة بيانات الويب أب (مسودة للاعتماد)

> مسودة فقط — تُعتمد قبل كتابة أي كود Worker. مبنية على قرارات `DECISIONS.md`
> ونتائج الـ Spike (Go على مسار WARP فقط). الخزن: D1 للبيانات العلائقية + KV لتاريخ الأسعار.

## المبادئ (من القرارات المعتمدة)

1. **حماية كتابات D1:** مفيش `last_checked_at` بيتحدث مع كل فحص. الكتابة بس عند
   تغيّر السعر أو إطلاق تنبيه، + نبضة 24 ساعة للمنتجات النشطة بس.
2. **مصدر حداثة البيانات هو جدول `poll_runs`** (صف واحد لكل دفعة فحص)، مش عمود
   زمني على كل منتج.
3. **HMAC على `timestamp.nonce.raw_body`** + جدول `ingest_nonces` ضد إعادة الإرسال.
4. **آلة حالات التنبيه:** `armed / triggered / paused / disabled` + هستيريسيس
   (التنبيه لا يُعاد إطلاقه إلا بعد رجوع السعر فوق الهدف + هامش).
5. **مفيش `password_hash`:** دخول بـ Telegram + OTP / Magic Link عبر `user_identities`.
6. **جودة العرض 4 حالات + EMA موزون زمنياً (30 يوم)** على نمط AzTracker.
7. **العمولة معيار ترجيح فقط** — الترتيب بجودة العرض أولاً.
8. **محرك اكتشاف منفصل عن محرك تتبع**، بقاعدة بيانات وتنبيهات مشتركة.
9. **مؤجل:** `store_offers`، Web Push، LLM self-healing، فيسبوك داخل التطبيق، Jumia.

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
| `discovered_via` | TEXT | `spike` / `discovery` / `user_link` |
| `first_seen_at` | TEXT | |

### `poll_runs` — سجل دفعات الفحص (نبضة الحداثة)

صف واحد لكل دفعة. حداثة أي منتج = `MAX(finished_at)` من `poll_runs` حيث الـ
`slice` يغطي الـ SKU و `products_ok > 0`.

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

### `tracked_products` — ما يتابعه كل مستخدم

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

### `discovery_candidates` — مرشحو محرك الاكتشاف (لأتمتة المسودات)

| العمود | النوع | ملاحظة |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sku` / `store` | TEXT | |
| `source` | TEXT | `mega` / `best_seller` / `feed` |
| `first_seen_at` / `last_seen_at` | TEXT | |
| `passes_filters` | INTEGER | عدّى فلاتر المسودة؟ (خصم + تقييم + مراجعات + مخزون) |
| `draft_posted` | INTEGER | اتعملت مسودة منشور؟ (النشر نفسه يدوي دائماً) |

## تاريخ الأسعار — KV (مش D1)

- **المفتاح:** `ph:noon:{sku}`
- **القيمة:** مصفوفة JSON مقصوصة (آخر ~1000 نقطة) من
  `{ts, price, original_price, seller, in_stock}`.
- **الكتابة بس عند تغيّر السعر** (نفس قاعدة D1) — يُعاد كتابة المفتاح مع
  `expirationTtl = 90 يوم` عند كل تحديث.
- **القراءة:** نقطة واحدة تجيب الرسم البياني كامل لمنتج (من غير JOIN).

## جودة العرض — 4 حالات (مشتقة عند القراءة، مش مخزنة)

نسبة النزول عن الـ EMA: `(ema_30d - current_price) / ema_30d`.
العتبة بتتدرج مع السعر على نمط AzTracker: **15% لمنتج ~100 جنيه**، **3% للابتوب
~100,000 جنيه** (استيفاء لوغاريتمي بينهما).

| الحالة | الشرط |
|---|---|
| `hot` | النزول ≥ العتبة |
| `good` | النزول ≥ نصف العتبة |
| `normal` | السعر تحت الـ EMA بس أقل من نصف العتبة |
| `bad` | السعر فوق الـ EMA |

## عقد `POST /api/ingest/noon`

نفس شكل سجل الـ Spike الموحّد — الفاتشر الحالي يبعت زي ما هو، من غير تغيير
في الحقول.

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
4. أدخل صف `poll_runs`.
5. لكل سجل `parse_ok`: لو المنتج جديد → أدخله؛ لو السعر/البائع/المخزون اتغير →
   حدّث `store_products` + أضف نقطة KV + حدّث `ema_30d` + قيّم التنبيهات؛
   لو مفيش تغيّر → **مفيش أي كتابة**.
6. الرد: `{accepted, skipped, failed: [{sku, reason}], alerts_fired: [...]}` —
   قبول جزئي، والمرسل يعيد بس السجلات الفاشلة.

## الترحيل من بيانات الـ Spike (مرة واحدة)

- `store_products`: آخر سجل لكل SKU من `spike/data/results.jsonl` (الـ 50 SKU).
- KV: كل النقاط من `results.jsonl` مقصوصة لآخر 1000 نقطة لكل SKU.
- `poll_runs`: الـ 5 تشغيلات (أرقامها: 43889479753، 43981543443، 44040433960،
  44138067464، 44211430129) بأعدادها المعروفة.
- سكربت ترحيل لمرة واحدة — مش جزء من كود الـ MVP.

## أسئلة مفتوحة (قبل كتابة الكود)

1. نبدأ التتبع بالـ **50 SKU بتوع الـ Spike** كمجموعة أولى؟ (المقترح: أيوه —
   عندهم تاريخ أسعار جاهز).
2. **حد المنتجات المتتبعة لكل مستخدم** في الـ MVP: 3 (زي AzTracker) ولا 5؟
3. التنبيهات في المرحلة 2: داخل التطبيق + إيميل — **مزوّد الإيميل** لسه مش محدد
   (Resend مجاني؟). نقرر دلوقتي ولا بعدين؟
4. محرك الاكتشاف (Mega / best-seller) يبدأ مع الـ MVP ولا يتأجل لما تتقرر
   أتمتة المسودات؟
