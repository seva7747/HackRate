import { CALL_TIMEOUT_MS } from "./config.js";

const MAX_PAGES = Number(process.env.MAX_CRAWL_PAGES || 6);
const PER_PAGE_TIMEOUT = 15000;

/**
 * Crawl a site for the judges: fetch the landing page, then follow same-origin
 * internal links (nav / feature / product / pricing / about style pages) up to
 * MAX_PAGES total, so Part 2 doesn't judge the whole project on the landing page
 * alone. Returns { url, pages: [{ url, title, text }] }.
 *
 * (Text extraction only — a headless-browser screenshot is out of scope here; for
 * client-rendered SPAs the prompt tells judges to treat thin pages as "unverified"
 * rather than "missing".)
 */
export async function scrapeSite(rawUrl) {
  const root = normalizeUrl(rawUrl);
  const origin = new URL(root).origin;

  const visited = new Set();
  const pages = [];

  const first = await fetchPage(root);
  visited.add(canon(root));
  pages.push(first);

  // Rank discovered links: prefer product/feature/how-it-works/pricing/about/demo.
  const candidates = rankLinks(first.links, origin, visited);

  for (const link of candidates) {
    if (pages.length >= MAX_PAGES) break;
    if (visited.has(canon(link))) continue;
    visited.add(canon(link));
    try {
      const p = await fetchPage(link);
      if (p.text.trim().length > 40) pages.push(p);
    } catch {
      /* skip unreachable sub-pages silently */
    }
  }

  return { url: root, pages: pages.map(({ url, title, text }) => ({ url, title, text })) };
}

// Back-compat single-page helper (not used by the main flow anymore).
export async function scrapePage(rawUrl) {
  const p = await fetchPage(normalizeUrl(rawUrl));
  return { url: p.url, title: p.title, text: p.text };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(PER_PAGE_TIMEOUT, CALL_TIMEOUT_MS));
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; HackRateBot/1.0; +http://localhost) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("html") && !ctype.includes("text")) throw new Error(`non-html: ${ctype}`);
    const html = await res.text();
    const { title, description, text } = extractReadable(html);
    const links = extractLinks(html, res.url || url);
    const body = [
      title && `TITLE: ${title}`,
      description && `DESCRIPTION: ${description}`,
      text,
    ].filter(Boolean).join("\n").slice(0, 4000);
    return { url: res.url || url, title, text: body, links };
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`timed out fetching ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const canon = (u) => u.replace(/#.*$/, "").replace(/\/$/, "");

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) throw new Error("no URL provided");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error("invalid URL"); }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" || host === "0.0.0.0" || host === "::1" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("refusing to fetch internal/local address");
  return parsed.toString();
}

function extractLinks(html, base) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 200) {
    try { out.push(new URL(m[1], base).toString()); } catch { /* ignore */ }
  }
  return out;
}

const PRIORITY = /(product|feature|how|work|pricing|about|demo|solution|use|docs|overview|tour|why)/i;
const SKIP = /(login|signin|sign-in|signup|register|privacy|terms|cookie|logout|\.(png|jpg|jpeg|gif|svg|pdf|zip|css|js))(\?|$)/i;

function rankLinks(links, origin, visited) {
  const seen = new Set();
  const same = [];
  for (const l of links) {
    let u;
    try { u = new URL(l); } catch { continue; }
    if (u.origin !== origin) continue;
    const c = canon(u.toString());
    if (visited.has(c) || seen.has(c)) continue;
    if (SKIP.test(u.pathname)) continue;
    seen.add(c);
    same.push(u.toString());
  }
  return same.sort((a, b) => (PRIORITY.test(b) ? 1 : 0) - (PRIORITY.test(a) ? 1 : 0));
}

function extractReadable(html) {
  const title = tag(html, "title");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const text = decodeEntities(stripTags(body)).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return { title, description, text: text.slice(0, 3500) };
}

function tag(html, name) {
  const m = html.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(stripTags(m[1])).trim() : "";
}
function metaContent(html, attrVal) {
  const m = html.match(new RegExp(`<meta[^>]*(?:name|property)=["']${attrVal}["'][^>]*content=["']([^"']*)["']`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}
function stripTags(s) {
  return s.replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
}
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
