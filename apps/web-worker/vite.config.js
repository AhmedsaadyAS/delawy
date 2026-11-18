// React Router v8 (framework mode) on Cloudflare Workers, JavaScript (no TypeScript).
// Plugin order per the Cloudflare migration guide: cloudflare() first, so the
// Vite plugin can claim the "ssr" environment and run it in workerd (with
// the D1 binding) during `react-router dev`. tailwindcss() stays before
// reactRouter() so the CSS pipeline is registered first.
import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), tailwindcss(), reactRouter()],
});
