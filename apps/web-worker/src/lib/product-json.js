// شكل JSON الموحّد لمنتج واحد في الـ API — مصدر واحد للحقيقة،
// يستخدمه مدخل الـ Worker القديم ومسارات /api في React Router معاً.
// (نفس الشكل الذي كان في src/index.js قبل نقله إلى هنا.)
import { fromMinor } from "./money.js";

export function productJson(p, deal, pointsCount) {
  return {
    id: p.id,
    store: p.store,
    external_id: p.external_id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    url: p.url,
    image_url: p.image_url || null,
    offer_code: p.offer_code,
    current_price_minor: p.current_price_minor,
    current_price: fromMinor(p.current_price_minor),
    current_original_price_minor: p.current_original_price_minor,
    current_original_price: fromMinor(p.current_original_price_minor),
    currency: p.currency,
    current_seller: p.current_seller,
    in_stock: p.in_stock,
    price_updated_at: p.price_updated_at,
    first_seen_at: p.first_seen_at,
    last_successful_check_at: p.last_successful_check_at,
    active: p.active,
    ema_minor: deal.ema_minor,
    ema: fromMinor(deal.ema_minor),
    deal_state: deal.state,
    drop_pct: deal.drop_pct,
    verified: deal.verified,
    price_source: deal.price_source,
    points_count: pointsCount,
  };
}
