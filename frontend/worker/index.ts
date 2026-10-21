/**
 * Link previews for shared hackathons.
 *
 * The site is a single-page app: every URL returns the same index.html, so a
 * link pasted into WhatsApp, Messages or Slack would preview as the generic
 * home page. This Worker runs only for "/" and "/h/<id>" (run_worker_first in
 * wrangler.jsonc); everything else is served straight from the static assets.
 * It looks the hackathon up in the GitHub Pages data snapshot (no sleeping API
 * involved) and adds Open Graph / Twitter tags with its name, prize, deadline
 * and summary. If the lookup fails, the page still goes out, with the
 * site-wide tags.
 */

import type { Hackathon } from "../src/lib/api";
import { deadlineLabel, FORMAT_LABEL, prizeText } from "../src/lib/format";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SNAPSHOT_URL: string;
  API_URL: string;
}

// Workers runtime globals (no @cloudflare/workers-types dependency for these few).
interface RewriterElement {
  append(content: string, options: { html: boolean }): void;
  setInnerContent(content: string): void;
}
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: { element(el: RewriterElement): void }): InstanceType<typeof HTMLRewriter>;
    transform(response: Response): Response;
  };
};

const SITE = "Hackathon Radar";
const SITE_DESCRIPTION = "Every open hackathon from Devpost, Devfolio, MLH, TAIKAI, ETHGlobal, Unstop and the web, ranked by prize.";
const DETAIL = /^\/h\/([0-9a-f-]{36})\/?$/i;

interface Preview {
  title: string;
  description: string;
  url: string;
  image: string;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function loadHackathon(env: Env, id: string): Promise<Hackathon | null> {
  try {
    const res = await fetch(`${env.SNAPSHOT_URL}/h/${id}.json`, {
      signal: AbortSignal.timeout(2500),
      // Cache at Cloudflare's edge for 10 minutes; the snapshot changes every 6 hours.
      cf: { cacheTtl: 600, cacheEverything: true },
    } as RequestInit);
    return res.ok ? ((await res.json()) as Hackathon) : null;
  } catch {
    return null;
  }
}

/** "$157,500 USD prize pool · Closes in 23 days · In person, Mumbai, India. <summary>" */
export function describe(h: Hackathon): string {
  const prize = h.prize_usd ? `${prizeText(h)} prize pool` : prizeText(h);
  const deadline = deadlineLabel(h);
  const where = h.format === "online" ? "Online" : [FORMAT_LABEL[h.format], h.format !== "unknown" ? h.location_text : null].filter(Boolean).join(", ");
  const facts = [prize, deadline && deadline.tone === "red" ? deadline.text : null, where].filter(Boolean).join(" · ");
  return clip(h.summary ? `${facts}. ${h.summary}` : facts, 240);
}

function tags(p: Preview): string {
  const meta = (attr: "property" | "name", key: string, value: string) => `<meta ${attr}="${key}" content="${escape(value)}">`;
  return [
    meta("property", "og:site_name", SITE),
    meta("property", "og:type", "website"),
    meta("property", "og:title", p.title),
    meta("property", "og:description", p.description),
    meta("property", "og:url", p.url),
    meta("property", "og:image", p.image),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", `${SITE}: every open hackathon, ranked by prize`),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", p.title),
    meta("name", "twitter:description", p.description),
    meta("name", "twitter:image", p.image),
  ].join("\n    ");
}

/**
 * The 6-hourly refresh, on time. GitHub's own schedule started runs 3 to 6 hours late and skipped
 * some, so the Worker's cron (wrangler.jsonc) asks the API to start the run that's due. The API
 * does nothing if one already ran since the slot. The free API may take a minute to wake up.
 */
async function tick(env: Env): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${env.API_URL}/schedule/tick`, { method: "POST", signal: AbortSignal.timeout(90_000) });
      console.log("schedule tick", res.status, await res.text());
      if (res.ok) return;
    } catch (e) {
      console.log("schedule tick failed", String(e));
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(tick(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await env.ASSETS.fetch(request);
    if (request.method !== "GET" || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;

    const url = new URL(request.url);
    const preview: Preview = {
      title: SITE,
      description: SITE_DESCRIPTION,
      url: `${url.origin}${url.pathname}`,
      image: `${url.origin}/og-image.png`,
    };
    const id = url.pathname.match(DETAIL)?.[1];
    const h = id ? await loadHackathon(env, id) : null;
    if (h) {
      preview.title = h.title;
      preview.description = describe(h);
    }
    const pageTitle = h ? `${h.title} · ${SITE}` : SITE;

    return new HTMLRewriter()
      .on("title", { element: (el) => el.setInnerContent(pageTitle) })
      .on("head", { element: (el) => el.append(tags(preview), { html: true }) })
      .transform(res);
  },
};
