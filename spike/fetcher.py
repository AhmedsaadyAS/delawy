#!/usr/bin/env python3
"""Noon Single-Product Fetcher — Spike only (no Worker, no D1, no bot).

Two strategies, one unified record per call:
- A (pdp): fetch the product page
  https://www.noon.com/egypt-en/{slug}/{SKU}/p/?o=offer_code
  Parser order (verified on a real PDP, 2026-11-16):
    1. json_ld — <script type="application/ld+json"> @type Product,
       offers.price / priceSpecification (StrikethroughPrice) /
       availability / seller.name.
    2. embedded_offer — the SSR JS payload offer object
       $R[n]={offer_code:"…", sku_config:"…", sale_price:1829,
       price:3300, store_name:"Dokkan Tech", stock:3, is_buyable:!0, …}
       parsed with the upstream _js_parse_value (no rewrite).
    3. data_qa — div-price-now / div-price-was (price only; seller
       unknown, in_stock = price present and no sold-out marker).
- B (search): fetch https://www.noon.com/egypt-en/search?q={SKU}
  (search target discovered in the PDP JSON-LD WebSite block, verified
  live 2026-11-16) and reuse upstream parse_products_from_html.
  WARNING measured 2026-11-16: search returns the *default* offer for
  the SKU, which can differ from the pinned ?o= offer — e.g. SKU
  N21961435A: search gave Egypt Laptop at 1799, PDP pinned gave
  Dokkan Tech at 1829. Strategy B therefore measures a different
  offer; the manual check (task 4) compares against the PDP URL.

Unified record fields:
  ts, sku, strategy, http_status, attempts, impersonate,
  akamai_challenge, parse_ok, parser_used, price, original_price,
  seller, in_stock, offer_code, elapsed_ms, error

Low volume: one curl_cffi Session per run (see run_spike.py), no
parallelism. Retries rotate the upstream impersonation pool.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote_plus

# Allow `python spike/fetcher.py` and `python spike/run_spike.py` from the
# repo root, and `pytest spike/` — scraper.py lives next to this file.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bs4 import BeautifulSoup  # noqa: E402
from curl_cffi import requests as cffi_requests  # noqa: E402

from scraper import (  # noqa: E402
    _IMPERSONATE_POOL,
    _PROXIES,
    _is_akamai_challenge,
    _js_parse_value,
    _parse_embedded_payload,
    _parse_next_data,
    _parse_product_cards,
    _parse_rsc_payload,
    parse_products_from_html,
)

SEARCH_URL = "https://www.noon.com/egypt-en/search?q={sku}"
PDP_URL = "https://www.noon.com/egypt-en/{slug}/{sku}/p/?o={offer_code}"

_OFFER_RE = re.compile(r"\$R\[\d+\]=\{offer_code:\"([^\"]+)\"")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Fetcher:
    """One curl_cffi session for a whole run (warm-up once)."""

    def __init__(self, proxy: str | None = None):
        self.proxies = {"http": proxy, "https": proxy} if proxy else _PROXIES
        self.session = cffi_requests.Session(proxies=self.proxies)
        self._warmed_up = False

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "Fetcher":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def warm_up(self) -> None:
        if self._warmed_up:
            return
        self._warmed_up = True
        try:
            self.session.get(
                "https://www.noon.com/egypt-en/",
                impersonate=_IMPERSONATE_POOL[0],
                timeout=30,
            )
        except Exception as e:  # warm-up failure is not fatal
            print(f"  warm-up failed (continuing): {e}")

    def fetch_page(self, url: str, max_attempts: int = 3) -> dict:
        """GET with impersonation rotation. Returns html/status/attempts.

        Akamai serves its JS challenge with HTTP 200 — that is a block,
        not a page (upstream _is_akamai_challenge).
        """
        self.warm_up()
        last_error: str | None = None
        status: int | None = None
        used = _IMPERSONATE_POOL[0]
        for attempt in range(1, max_attempts + 1):
            used = _IMPERSONATE_POOL[(attempt - 1) % len(_IMPERSONATE_POOL)]
            try:
                resp = self.session.get(
                    url,
                    headers={"Referer": "https://www.noon.com/egypt-en/"},
                    impersonate=used,
                    timeout=90,
                )
            except Exception as e:
                last_error = f"network error: {e}"
                status = None
            else:
                status = resp.status_code
                if resp.ok and _is_akamai_challenge(resp.text):
                    last_error = f"Akamai JS challenge ({len(resp.text):,} bytes)"
                    return {
                        "html": resp.text, "http_status": status,
                        "attempts": attempt, "impersonate": used,
                        "akamai_challenge": True, "error": last_error,
                    }
                if resp.ok:
                    return {
                        "html": resp.text, "http_status": status,
                        "attempts": attempt, "impersonate": used,
                        "akamai_challenge": False, "error": None,
                    }
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                if 400 <= resp.status_code < 500 and resp.status_code != 403:
                    break
            if attempt < max_attempts:
                time.sleep(2 * attempt)
        return {
            "html": "", "http_status": status, "attempts": max_attempts,
            "impersonate": used, "akamai_challenge": False,
            "error": f"fetch failed after {max_attempts} attempts: {last_error}",
        }


# ── PDP parsers (strategy A) ─────────────────────────────────────────────

def parse_json_ld(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict) or item.get("@type") != "Product":
                continue
            offers = item.get("offers") or {}
            price = offers.get("price")
            if price is None:
                continue
            spec = offers.get("priceSpecification") or {}
            original = spec.get("price") if spec.get("priceType", "").endswith("StrikethroughPrice") else None
            availability = str(offers.get("availability", ""))
            seller = offers.get("seller") or {}
            return {
                "price": float(price),
                "original_price": float(original) if original else float(price),
                "seller": seller.get("name") if isinstance(seller, dict) else None,
                "in_stock": "InStock" in availability,
                "parser_used": "json_ld",
            }
    return None


def parse_embedded_offer(html: str, sku: str, offer_code: str = "") -> dict | None:
    """Parse the SSR offer object $R[n]={offer_code:…, sale_price:…}.

    Verified shape (real PDP 2026-11-16): the offer object itself holds
    sale_price, price, store_name, stock and is_buyable. Prefer the
    pinned offer_code; fall back to any offer whose sku_config == sku.
    """
    for match in _OFFER_RE.finditer(html):
        if offer_code and match.group(1) != offer_code:
            continue
        try:
            obj, _ = _js_parse_value(html, match.end() - len(match.group(0)) + match.group(0).index("{"))
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get("sku_config") not in (sku, None) and obj.get("sku") != sku:
            continue
        sale = obj.get("sale_price") or obj.get("price")
        if sale is None:
            continue
        stock = obj.get("stock")
        return {
            "price": float(sale),
            "original_price": float(obj.get("price") or sale),
            "seller": obj.get("store_name") or None,
            "in_stock": bool(obj.get("is_buyable", True)) and (stock is None or int(stock) > 0),
            "parser_used": "embedded_offer",
        }
    return None


def parse_data_qa(html: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    def _price(qa: str) -> float | None:
        tag = soup.find(attrs={"data-qa": qa})
        if not tag:
            return None
        m = re.search(r"[\d,]+\.?\d*", tag.get_text(strip=True).replace(",", ""))
        return float(m.group()) if m else None

    price = _price("div-price-now")
    if price is None:
        return None
    original = _price("div-price-was") or price
    text = soup.get_text(" ", strip=True).lower()
    return {
        "price": price,
        "original_price": original,
        "seller": None,  # seller has no stable data-qa on the PDP
        "in_stock": "sold out" not in text and "out of stock" not in text,
        "parser_used": "data_qa",
    }


def parse_pdp(html: str, sku: str, offer_code: str = "") -> dict:
    for parser in (
        lambda h: parse_json_ld(h),
        lambda h: parse_embedded_offer(h, sku, offer_code),
        lambda h: parse_data_qa(h),
    ):
        result = parser(html)
        if result:
            return {**result, "parse_ok": True}
    return {
        "price": None, "original_price": None, "seller": None,
        "in_stock": None, "parser_used": None, "parse_ok": False,
    }


# ── Search parser (strategy B) ───────────────────────────────────────────

def parse_search(html: str, sku: str) -> dict:
    """Reuse upstream list parsers, in order, and report which one fired."""
    for name, fn in (
        ("embedded_payload", _parse_embedded_payload),
        ("rsc_payload", _parse_rsc_payload),
        ("next_data", _parse_next_data),
        ("product_cards", _parse_product_cards),
    ):
        products = fn(html)
        for p in products:
            if p.get("sku") == sku:
                return {
                    "price": float(p["sale_price"]),
                    "original_price": float(p.get("original_price") or p["sale_price"]),
                    "seller": p.get("store_name") or None,
                    "in_stock": True,  # _normalize_item drops non-buyable items
                    "parser_used": name,
                    "parse_ok": True,
                }
    # Fall back to the generic entry point (same parsers, no name reported).
    for p in parse_products_from_html(html):
        if p.get("sku") == sku:
            return {
                "price": float(p["sale_price"]),
                "original_price": float(p.get("original_price") or p["sale_price"]),
                "seller": p.get("store_name") or None,
                "in_stock": True,
                "parser_used": "parse_products_from_html",
                "parse_ok": True,
            }
    return {
        "price": None, "original_price": None, "seller": None,
        "in_stock": None, "parser_used": None, "parse_ok": False,
    }


# ── Unified fetch ────────────────────────────────────────────────────────

def fetch_product(
    fetcher: Fetcher,
    *,
    sku: str,
    url: str = "",
    slug: str = "",
    offer_code: str = "",
    strategy: str = "A",
) -> tuple[dict, str]:
    """Fetch one SKU with one strategy. Returns (record, html)."""
    started = time.monotonic()
    if strategy == "A":
        target = url or PDP_URL.format(slug=slug or sku, sku=sku, offer_code=offer_code)
    elif strategy == "B":
        target = SEARCH_URL.format(sku=quote_plus(sku))
    else:
        raise ValueError(f"unknown strategy {strategy!r} (use A or B)")

    fetched = fetcher.fetch_page(target)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    record: dict = {
        "ts": utc_now(),
        "sku": sku,
        "strategy": strategy,
        "http_status": fetched["http_status"],
        "attempts": fetched["attempts"],
        "impersonate": fetched["impersonate"],
        "akamai_challenge": fetched["akamai_challenge"],
        "parse_ok": False,
        "parser_used": None,
        "price": None,
        "original_price": None,
        "seller": None,
        "in_stock": None,
        "offer_code": offer_code,
        "elapsed_ms": elapsed_ms,
        "error": fetched["error"],
    }
    html = fetched["html"]
    if fetched["error"] is None and html:
        parsed = parse_pdp(html, sku, offer_code) if strategy == "A" else parse_search(html, sku)
        record.update({k: parsed[k] for k in ("parse_ok", "parser_used", "price", "original_price", "seller", "in_stock")})
        if not parsed["parse_ok"]:
            record["error"] = "parse_failed"
    return record, html
