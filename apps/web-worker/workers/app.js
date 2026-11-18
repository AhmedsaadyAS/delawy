// دخول الـ Worker (قالب Cloudflare الرسمي لـ React Router v8):
// يفوّض كل طلب إلى React Router. البيئة (ومنها ربط D1 المسمى DB)
// متاحة للـ loaders عبر `cloudflare:workers` أو `context.cloudflare`
// (المكوّن يوفّرها) — بلا استدعاء HTTP للـ API العامة من السيرفر.
import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },
};
