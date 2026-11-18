// Route config (explicit — flatRoutes was removed in React Router 7.18).
// Paths mirror the old Worker entry exactly: "/" and "/products/:id"
// for HTML, "/api/*" for the JSON contracts.
import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.jsx"),
  route("products/:id", "routes/products.$id.jsx"),
  route("api/health", "routes/api.health.jsx"),
  route("api/products", "routes/api.products.jsx"),
  route("api/products/:id", "routes/api.products.$id.jsx"),
  route("api/products/:id/history", "routes/api.products.$id.history.jsx"),
];
