// Query-string pagination parsing with sane defaults and hard caps.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Parse ?page=&limit= from a URLSearchParams.
 * Returns { page, limit, offset }. Invalid values fall back to defaults.
 */
export function parsePagination(params, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  let page = parseInt(params.get('page') ?? '', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  let limit = parseInt(params.get('limit') ?? '', 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta(total, { page, limit }) {
  return {
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Parse ?days= — only 7, 30 or 90 are valid; default 30. */
export function parseDays(params, fallback = 30) {
  const d = parseInt(params.get('days') ?? '', 10);
  return [7, 30, 90].includes(d) ? d : fallback;
}
