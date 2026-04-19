import { Type } from "@sinclair/typebox";
import { truncateText } from "./util.js";

const WebsearchParams = Type.Object({
  query: Type.String({ description: "Search query." }),
  limit: Type.Optional(Type.Number({ description: "Maximum results. Default 6." })),
});

type WebsearchInput = { query: string; limit?: number };

type SearchResult = { title: string; url: string; snippet: string };

/**
 * Lightweight DuckDuckGo HTML scraper — no API key, no rate limit auth. We parse the
 * top results with regex rather than pulling in cheerio, to keep the daemon bundle lean.
 * If DDG rate-limits or changes markup, fall back to a Wikipedia OpenSearch result so the
 * agent always gets *something* actionable.
 */
async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (pi-agent-sandbox)",
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned status ${res.status}`);
  const html = await res.text();

  const out: SearchResult[] = [];
  const resultRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) !== null) {
    const rawUrl = m[1] ?? "";
    // DDG wraps links in /l/?uddg=<encoded>&…
    const uddgMatch = /uddg=([^&"]+)/.exec(rawUrl);
    const url = uddgMatch ? decodeURIComponent(uddgMatch[1] ?? "") : rawUrl;
    const title = stripTags(m[2] ?? "").trim();
    const snippet = stripTags(m[3] ?? "").trim();
    if (title && url) out.push({ title, url, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?" +
    new URLSearchParams({
      action: "opensearch",
      search: query,
      limit: String(limit),
      namespace: "0",
      format: "json",
    }).toString();
  const res = await fetch(url);
  const json = (await res.json()) as [string, string[], string[], string[]];
  const titles = Array.isArray(json[1]) ? json[1] : [];
  const snippets = Array.isArray(json[2]) ? json[2] : [];
  const urls = Array.isArray(json[3]) ? json[3] : [];
  const out: SearchResult[] = [];
  for (let i = 0; i < Math.min(titles.length, limit); i += 1) {
    out.push({
      title: titles[i] ?? "",
      url: urls[i] ?? "",
      snippet: snippets[i] ?? "",
    });
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function createWebsearchTool() {
  return {
    name: "websearch",
    label: "websearch",
    description:
      "Search the web and return the top result titles, URLs, and snippets. Use `webfetch` afterward to read a specific result in depth.",
    parameters: WebsearchParams,
    async execute(_id: string, params: WebsearchInput) {
      const query = params.query.trim();
      if (!query) throw new Error("query cannot be empty");
      const limit = Math.min(
        Math.max(1, Number.isFinite(params.limit) ? (params.limit as number) : 6),
        10,
      );

      let results: SearchResult[] = [];
      let provider = "duckduckgo";
      try {
        results = await searchDuckDuckGo(query, limit);
      } catch {
        // fall through to Wikipedia
      }

      if (results.length === 0) {
        provider = "wikipedia";
        results = await searchWikipedia(query, limit);
      }

      const rendered = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: truncateText(rendered || "No web results found."),
          },
        ],
        details: {
          query,
          provider,
          count: results.length,
        },
      };
    },
  };
}
