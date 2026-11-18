// Unit tests for the SQL filter layer in db.js, using a stub D1 that
// records the query + binds. Proves filters are applied in SQL,
// before LIMIT/OFFSET (pagination counts the filtered set).
import { test } from "node:test";
import assert from "node:assert/strict";
import { countProducts, listProducts, listCategories } from "../src/lib/db.js";

function stubDb({ firstRow = null, allRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            first: async () => firstRow,
            all: async () => ({ results: allRows }),
          };
        },
      };
    },
  };
}

test("countProducts: no filters keeps the old query shape", async () => {
  const db = stubDb({ firstRow: { n: 50 } });
  assert.equal(await countProducts(db, { active: 1 }), 50);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /WHERE active = \?/);
  assert.deepEqual(db.calls[0].args, [1]);
});

test("countProducts: q/category/inStock add bound WHERE clauses", async () => {
  const db = stubDb({ firstRow: { n: 3 } });
  await countProducts(db, { q: "Anker", category: "Phones", inStock: 1 });
  const { sql, args } = db.calls[0];
  assert.match(sql, /name LIKE \? ESCAPE/);
  assert.match(sql, /category = \?/);
  assert.match(sql, /in_stock = 1/);
  assert.deepEqual(args, [1, "%Anker%", "%Anker%", "Phones"]);
});

test("listProducts: LIKE wildcards in q are escaped, limit/offset stay last", async () => {
  const db = stubDb({ allRows: [] });
  await listProducts(db, { q: "100%", limit: 20, offset: 0 });
  const { sql, args } = db.calls[0];
  assert.match(sql, /LIMIT \? OFFSET \?/);
  assert.deepEqual(args, [1, "%100\\%%", "%100\\%%", 20, 0]);
});

test("listProducts: inStock 0 filters out-of-stock only (NULL stays out)", async () => {
  const db = stubDb({ allRows: [] });
  await listProducts(db, { inStock: 0, limit: 20, offset: 40 });
  assert.match(db.calls[0].sql, /in_stock = 0/);
  assert.deepEqual(db.calls[0].args, [1, 20, 40]);
});

test("listCategories: distinct non-empty categories, ordered", async () => {
  const db = stubDb({ allRows: [{ category: "Laptops" }, { category: "Phones" }] });
  assert.deepEqual(await listCategories(db), ["Laptops", "Phones"]);
  assert.match(db.calls[0].sql, /SELECT DISTINCT category/);
});
