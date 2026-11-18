// مسار مورد — نفس عقد /api/health في المدخل القديم، بلا تغيير.
import { getCounts } from "../../src/lib/db.js";
import { env } from "cloudflare:workers";

export async function loader() {
  const counts = await getCounts(env.DB);
  return Response.json({ ok: true, version: "0.1.0", store: "noon", ...counts });
}
