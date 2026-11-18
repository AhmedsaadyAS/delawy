-- 0002_add_image_url.sql — product image URL on store_products.
--
-- Images come from the Spike fetcher (PDP JSON-LD `image`, first URL) via
-- records, with apps/web-worker/seed/sku-images.json as the seed fallback.
-- The URL points at Noon's public CDN (f.nooncdn.com); the Worker only
-- stores the URL, it never downloads or re-hosts the image.
-- NULL means no image was captured yet — the UI shows a placeholder.

ALTER TABLE store_products ADD COLUMN image_url TEXT;
