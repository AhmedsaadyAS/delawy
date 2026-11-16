# Third-Party Notices

## noon-deals-bot — MIT License

- Source: https://github.com/Vette1123/noon-deals-bot
- Copyright (c) 2026 Mohamed Gado
- Used in the delawy Spike (`spike/`), with the MIT license text below
  copied verbatim from that repo's `LICENSE` file.

Copied / adapted from it:
- `spike/scraper.py` — copied verbatim (functions `_fetch_html`,
  `_is_akamai_challenge`, `_normalize_item`, `_js_parse_value`,
  `_parse_embedded_payload`, `parse_products_from_html`, `feed_url`,
  `feed_tasks`, `fetch_products`, plus the RSC / `__NEXT_DATA__` /
  product-card fallback parsers). Source header at the top of the file.
- `spike/categories.py` — copied verbatim (`FEED_CODES`, `CATEGORIES`,
  `commission_rate`, `category_label`). Source header at the top.
- `.github/workflows/spike.yml` — the "Set up Cloudflare WARP" step is
  copied from that repo's `.github/workflows/bot.yml`.
- `spike/samples/list_sample.html` — the embedded-payload fixture is from
  that repo's test suite (`tests/test_scraper.py`, `MOCK_EMBEDDED_HTML`).

No other third-party code is copied into this repo for the Spike.

---

MIT License

Copyright (c) 2026 Mohamed Gado

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
