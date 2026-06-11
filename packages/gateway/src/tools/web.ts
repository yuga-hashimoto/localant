import { z } from "zod";
import type { Gateway } from "../gateway.js";

/** Strip HTML tags to approximate readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Web tools. We deliberately do NOT ship a `websearch` tool — ChatGPT already
 * has native web search, and search is not a local resource, so tool-ifying it
 * would only bloat the surface and confuse tool selection.
 *
 * `webfetch` IS kept because it runs on the LOCAL machine: it can reach
 * `http://localhost:*` dev servers, LAN devices, and services gated by local IP
 * that ChatGPT's cloud fetch cannot — a genuine local-only capability.
 */
export function registerWebTools(gw: Gateway): void {
  const r = gw.registry;
  void gw;

  r.register({
    name: "webfetch",
    description:
      "Fetch a URL from the LOCAL machine over HTTP(S) — including localhost/LAN dev servers ChatGPT can't reach. HTML is reduced to text. Risk 3.",
    risk: 3,
    inputSchema: z.object({
      url: z.string().url(),
      timeoutMs: z.number().int().min(1).max(120_000).default(20_000),
      maxBytes: z.number().int().min(1).max(5_000_000).default(1_000_000),
      extractText: z.boolean().default(true),
    }),
    summarize: (i) => `webfetch ${i.url}`,
    handler: async (i) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), i.timeoutMs);
      try {
        const res = await fetch(i.url, { signal: controller.signal, redirect: "follow" });
        const contentType = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        const body = raw.slice(0, i.maxBytes);
        const isHtml = contentType.includes("html") || /^\s*<(?:!doctype|html)/i.test(body);
        return {
          url: i.url,
          status: res.status,
          contentType,
          body,
          text: i.extractText && isHtml ? htmlToText(body).slice(0, i.maxBytes) : undefined,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
