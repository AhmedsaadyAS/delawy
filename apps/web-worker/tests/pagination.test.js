import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, pageMeta, parseDays } from '../src/lib/pagination.js';

const params = (qs) => new URLSearchParams(qs);

test('pagination defaults', () => {
  assert.deepEqual(parsePagination(params('')), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(parsePagination(params('page=3&limit=10')), {
    page: 3,
    limit: 10,
    offset: 20,
  });
});

test('pagination clamps invalid values', () => {
  assert.deepEqual(parsePagination(params('page=0&limit=9999')), {
    page: 1,
    limit: 100,
    offset: 0,
  });
  assert.deepEqual(parsePagination(params('page=abc&limit=-5')), {
    page: 1,
    limit: 20,
    offset: 0,
  });
});

test('pageMeta', () => {
  assert.deepEqual(pageMeta(95, { page: 2, limit: 20 }), {
    page: 2,
    limit: 20,
    total: 95,
    total_pages: 5,
  });
  assert.deepEqual(pageMeta(0, { page: 1, limit: 20 }).total_pages, 1);
});

test('parseDays only allows 7, 30, 90', () => {
  assert.equal(parseDays(params('days=7')), 7);
  assert.equal(parseDays(params('days=90')), 90);
  assert.equal(parseDays(params('days=5')), 30);
  assert.equal(parseDays(params('')), 30);
  assert.equal(parseDays(params('days=abc')), 30);
});
