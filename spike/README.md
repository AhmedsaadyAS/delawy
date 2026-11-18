# Spike — Noon Single-Product Fetcher (48–72h)

> **CLOSED — 2026-11-18 (user decision).** Final decision: **Go, on the WARP path only.**
> 5 runs, 580 records (500 WARP + 80 control) **at close time (10:19 EET)**:
> WARP 500/500 = 100% success, control 64/80 = 80% (HTTP 403 Access Denied on
> blocking days, `akamai_challenge=false`), 0 Akamai challenges, 0 HTTP 429.
> Manual accuracy check 28/28 rows matched (rounds 1–2; round 3 skipped —
> sample was 28 of the planned 45 rows). Price-change evidence was thin:
> only 4 of 50 SKUs moved price across 6 runs. Next step: `SCHEMA.md`
> (Schema v2) → `POST /api/ingest/noon`. Dispatch test and Worker edge probe
> were not run — closed with the Spike, so do NOT promise an "update now" button.
>
> **After close (2026-11-18):** the workflow was NOT disabled — it keeps
> collecting price history for the EMA cold start, now on a **6-hour cron**
> (`0 */6 * * *`, see `.github/workflows/spike.yml` — re-upload needed) instead
> of hourly. The tracked set was refreshed the same day: 12 accessories out,
> 6 phones + 6 laptops in (see `skus.csv`); the 12 new SKUs start `unproven`.
> Record counts in this file were true at close time only — the live dashboard
> is authoritative for current totals (700 records by the 6th run, 10:42 EET).

> Spike only. No Worker, no D1, no Telegram bot, no feature outside this Spike.
> Question to answer with numbers: can we fetch a Noon Egypt product's
> price by link/SKU stably and accurately?

## Files

| File | What it is |
|---|---|
| `scraper.py` | Copied verbatim from Vette1123/noon-deals-bot (MIT) — `_fetch_html`, `_is_akamai_challenge`, `_normalize_item`, `_js_parse_value`, `_parse_embedded_payload`, `parse_products_from_html`, `feed_url`. See `../THIRD_PARTY_NOTICES.md`. |
| `categories.py` | Copied verbatim from the same repo (MIT) — `FEED_CODES`, `CATEGORIES`. |
| `build_sku_list.py` | Builds `skus.csv`: 50 SKUs from 5 feeds (page 1 each). |
| `skus.csv` | The 50 SKUs: buckets <500 (12), 500–3000 (16), 3000–15000 (14), >15000 (8); 42 discounted, 8 not; 37 sellers (max 3 each); 38 brands; 43 fulfilled_by_noon + 5 not (of the 48 still on feed page 1 at re-check — 2 SKUs rotated out of page 1 within an hour, PDPs still valid). Generated 2026-11-16. |
| `fetcher.py` | Strategy A (PDP) + B (search), one unified record per call. |
| `run_spike.py` | Batch runner: A then B per SKU, 2–5 s random delay, stops after HTTP 429 twice in a row, appends to `data/results.jsonl`. |
| `test_fetcher.py` | pytest, parsers only, no network. Fixtures in `samples/`. |
| `samples/pdp_sample.html` | Trimmed real PDP (N21961435A, 2026-11-16): JSON-LD Product + data-qa divs + complete SSR offer object. |
| `samples/list_sample.html` | Upstream test fixture (embedded JS payload + product card). |
| `data/results.jsonl` | Appended by every run (committed by Actions). |
| `data/failures/` | First 20 KB of HTML on parse failure — Actions artifact only, never committed (see `.gitignore`). |

## What was discovered (real pages, 2026-11-16)

- Local fetch works from this environment: no Akamai challenge on feed
  pages, PDP or search (5 feed pages, 1 PDP, 1 search — all HTTP 200).
- PDP parser order, all three agree on the test product (1829 / 3300,
  Dokkan Tech): JSON-LD Product/offers → SSR offer object
  (`$R[n]={offer_code, sku_config, sale_price, price, store_name, stock,
  is_buyable}`) → data-qa `div-price-now` / `div-price-was`.
- Search URL: `https://www.noon.com/egypt-en/search?q={SKU}` (from the
  JSON-LD WebSite SearchAction). It works and returns 1 product for a SKU.
- **Strategy B measures a different offer:** for N21961435A, search
  returned Egypt Laptop at 1799 while the pinned PDP (`?o=f96a…`)
  returned Dokkan Tech at 1829. Same SKU, different seller/price.
  The manual check (task 4) compares against the PDP URL, not search.
- Feeds used: `electronics-and-mobiles/mobiles-and-accessories`
  (not in upstream FEED_CODES, but a real browse path — 50 products on
  page 1, rate 2% in upstream `_RATE_PREFIXES`),
  `electronics-and-mobiles/computers-and-accessories`,
  `electronics-and-mobiles/wearable-technology`,
  `electronics-and-mobiles/home-audio`, `home-and-kitchen/home-appliances-31235`.

## Run locally

```bash
python -m venv .venv && .venv/bin/pip install -r spike/requirements.txt
python -m pytest spike/test_fetcher.py -q
python spike/run_spike.py --only-sku N21961435A --strategy A
python spike/run_spike.py   # full batch: 50 SKUs × A + B
```

## Run in GitHub Actions

`.github/workflows/spike.yml`: hourly cron + `workflow_dispatch`
(optional `sku` input = one SKU only). Two jobs, sequential:
`spike-warp` (50 SKUs, WARP proxy `socks5h://127.0.0.1:40000`) then
`spike-control` (first 10 SKUs, no WARP). Each appends to
`spike/data/results.jsonl` and commits with `[skip ci]`
(`git pull --rebase` before push). `publish-pages` deploys `public/`.

**Before the first run:** Settings → Pages → Source: GitHub Actions
(the repo needs this once; the workflow cannot enable Pages itself).

## المهام 4-7

### 4. التحقق اليدوي من الدقة

```bash
python spike/compare_manual.py   # بعد ملء spike/manual_check.csv
```

`spike/manual_check.csv`: 15 SKU عشوائية × 3 جولات (45 صفاً). افتح كل
لينك من المتصفح **بدون تسجيل دخول**، واملأ `checked_at` (UTC بصيغة ISO)
و`price_in_browser` و`seller_in_browser` و`in_stock_in_browser`
(true/false). القاعدة: أي فرق في السعر = سعر خاطئ، وفرق البائع = خطأ
منفصل. المقارنة تتم مع أقرب سجل **أسلوب A** خلال 30 دقيقة (لينك الـ PDP
نفسه — وليس البحث، لأن البحث قد يرجع عرضاً وبائعاً مختلفين).
الناتج: `spike/data/manual_summary.json`.

### 5. اختبار الفورية (workflow_dispatch)

```bash
export GH_TOKEN="..."   # fine-grained token، Actions: read and write
python spike/dispatch_test.py --dry-run   # تحقق فقط، بدون إرسال
python spike/dispatch_test.py             # 10 مرات، SKU واحد
```

يقيس زمن البدء والاكتمال لكل مرة، ويكتب `spike/data/dispatch.jsonl`.
التوكن من متغير البيئة فقط، ولا يُحفظ في الريبو أبداً. لا تشغّله أثناء
Run ساعي جارٍ إذا أردت أرقاماً نظيفة — مجموعة الـ concurrency الواحدة
تضع الـ dispatch في طابور خلف الـ Run الجاري.

### 6. اختبار جلب Worker (اختياري)

انظر `spike/worker-probe/README.md`. يُحذف المجلد كاملاً بعد الـ Spike.

### 7. صفحة النتائج وقرار Go/No-Go

```bash
python spike/report.py   # يكتب public/results.json و spike/SPIKE-RESULTS.md
```

الـ workflow يشغّل `report.py` في job النشر قبل رفع `public/`، فالصفحة
تتحدث كل ساعة. القرار: Go إذا نسبة النجاح 90% فأكثر **و** عدد الأسعار
الخاطئة صفر في العينة اليدوية، وإلا No-Go مع السبب. بدون سجلات أو بدون
عينة يدوية، القرار "بانتظار البيانات" وليس Go.

## Go / No-Go (task 7)

Go if success rate ≥ 90% **and** zero wrong prices in the manual sample;
otherwise No-Go with the reason. Computed by `spike/report.py`
(task 7 — not in this commit).
