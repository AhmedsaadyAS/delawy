// Spike-only probe: does Akamai block a direct fetch from a Cloudflare
// Worker? Fetches 10 Noon PDP URLs and returns ONLY status + an
// akamai_challenge flag per URL. No price parsing, no storage, no
// production logic. Delete the whole spike/worker-probe/ directory
// after the Spike.
import urls from "./urls.json";

// Same markers as spike/scraper.py _is_akamai_challenge: Akamai serves
// its JS bot-check with HTTP 200 and a tiny page.
const CHALLENGE_MARKERS = ["sec-if-cpt-container", "_sec_bot_detect", "Powered and protected by"];

function isAkamaiChallenge(text) {
  return text.length < 50_000 && CHALLENGE_MARKERS.some((m) => text.includes(m));
}

export default {
  async fetch(request) {
    const results = [];
    for (const url of urls) {
      const started = Date.now();
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            Referer: "https://www.noon.com/egypt-en/",
          },
        });
        const text = await resp.text();
        results.push({
          url,
          http_status: resp.status,
          akamai_challenge: isAkamaiChallenge(text),
          elapsed_ms: Date.now() - started,
          error: null,
        });
      } catch (e) {
        results.push({
          url,
          http_status: null,
          akamai_challenge: false,
          elapsed_ms: Date.now() - started,
          error: String(e),
        });
      }
    }
    const blocked = results.filter((r) => r.akamai_challenge).length;
    return Response.json({
      probed_at: new Date().toISOString(),
      total: results.length,
      akamai_challenged: blocked,
      blocked_immediately: blocked === results.length,
      results,
    });
  },
};
