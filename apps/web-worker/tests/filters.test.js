// Unit tests for home-page filter parsing (URL -> loader filters).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilters, filtersToParams } from "../app/lib/filters.js";

test("parseFilters: empty query gives null filters and page 1", () => {
  const f = parseFilters(new URLSearchParams(""));
  assert.equal(f.q, null);
  assert.equal(f.category, null);
  assert.equal(f.inStock, null);
  assert.equal(f.page, 1);
  assert.equal(f.limit, 20);
  assert.equal(f.offset, 0);
});

test("parseFilters: q is trimmed and capped, stock '1'/'0' map to 1/0", () => {
  const f = parseFilters(new URLSearchParams("q=%20Anker%20&category=Phones&stock=1&page=2"));
  assert.equal(f.q, "Anker");
  assert.equal(f.category, "Phones");
  assert.equal(f.inStock, 1);
  assert.equal(f.page, 2);
  assert.equal(f.offset, 20);
  const g = parseFilters(new URLSearchParams("stock=0"));
  assert.equal(g.inStock, 0);
  const h = parseFilters(new URLSearchParams("stock=all"));
  assert.equal(h.inStock, null);
});

test("parseFilters: blank q/category become null", () => {
  const f = parseFilters(new URLSearchParams("q=%20%20&category="));
  assert.equal(f.q, null);
  assert.equal(f.category, null);
});

test("filtersToParams: keeps filters, drops page 1 and default limit", () => {
  const params = filtersToParams({ q: "Anker", category: null, inStock: 1, page: 1, limit: 20 });
  assert.equal(params.toString(), "q=Anker&stock=1");
  const next = filtersToParams({ q: "Anker", category: null, inStock: 1, page: 1, limit: 20 }, { page: 2 });
  assert.equal(next.get("page"), "2");
  assert.equal(next.get("q"), "Anker");
});
