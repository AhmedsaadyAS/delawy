# Worker Probe (optional, Spike only)

Does Akamai block a direct fetch from a Cloudflare Worker? This tiny
project fetches the first 10 PDP URLs from `spike/skus.csv` and returns
**only** `http_status` + `akamai_challenge` per URL. No price parsing,
no storage, no production logic.

## Run

```bash
cd spike/worker-probe
npm install
npx wrangler dev
# in another terminal:
curl http://localhost:8787/
```

To test from Cloudflare's edge instead of your machine (optional):
`npx wrangler deploy`, then curl the `*.workers.dev` URL once and note
the result. `wrangler login` needs a Cloudflare account; no secrets
are stored in this repo.

## Reading the result

- `blocked_immediately: true` — Akamai challenges every Worker fetch:
  the direct-Worker path is dead, keep the GitHub Actions route.
- `akamai_challenged: 0` — Worker fetches pass: the direct path is
  worth testing further after the Spike.
- Anything in between — note the count in `SPIKE-RESULTS.md`.

## Delete after the Spike

```bash
rm -rf spike/worker-probe
```
