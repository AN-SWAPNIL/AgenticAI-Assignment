import { Type } from "@sinclair/typebox";
import { truncateText } from "./util.js";

const WebfetchParams = Type.Object({
  url: Type.String({ description: "Absolute URL to fetch (http:// or https://)." }),
  as: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown")], {
      description:
        "Post-processing: `text` strips HTML tags; `markdown` applies a best-effort HTML→markdown conversion. Default: markdown.",
    }),
  ),
});

type WebfetchInput = { url: string; as?: "text" | "markdown" };

function htmlToMarkdown(html: string): string {
  // Lightweight dependency-free conversion. Good enough for a sandbox tool; agents almost
  // always just need the readable prose, and we truncate aggressively anyway.
  let out = html;

  // Strip script/style/noscript blocks entirely.
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Convert common block elements into paragraph breaks.
  out = out.replace(/<\/?(p|div|section|article|main|header|footer|br|li|tr)\b[^>]*>/gi, "\n");
  out = out.replace(/<\/?(h[1-6])\b[^>]*>/gi, "\n\n");

  // Links: <a href="X">Y</a> → [Y](X)
  out = out.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, "");

  // Decode a small set of common entities.
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function createWebfetchTool() {
  return {
    name: "webfetch",
    label: "webfetch",
    description:
      "Fetch a URL and return its readable content. Returns trimmed text or markdown; large responses are truncated.",
    parameters: WebfetchParams,
    async execute(_id: string, params: WebfetchInput) {
      const url = params.url.trim();
      if (!/^https?:\/\//i.test(url)) {
        throw new Error("webfetch requires an absolute http(s) URL");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "user-agent": "pi-agent-sandbox/1.0" },
        });
        const body = await response.text();
        const contentType = response.headers.get("content-type") || "unknown";
        const mode = params.as ?? "markdown";
        const looksHtml =
          contentType.includes("html") || /<\s*html[\s>]/i.test(body.slice(0, 1024));
        const processed = looksHtml && mode !== "text" ? htmlToMarkdown(body) : body;

        return {
          content: [{ type: "text" as const, text: truncateText(processed) }],
          details: {
            url,
            status: response.status,
            contentType,
            mode,
            bytes: body.length,
          },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
