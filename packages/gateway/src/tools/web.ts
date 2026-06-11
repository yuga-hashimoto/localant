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

export function registerWebTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "webfetch",
    description: "Fetch a URL over HTTP(S) and return the body (HTML is also reduced to text). Risk 3.",
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

  r.register({
    name: "websearch",
    description:
      "Web search. Reads a provider API key from the secret vault (TAVILY_API_KEY or BRAVE_API_KEY). Returns guidance when none is set.",
    risk: 3,
    inputSchema: z.object({ query: z.string(), maxResults: z.number().int().min(1).max(20).default(5) }),
    summarize: (i) => `websearch ${i.query.slice(0, 60)}`,
    handler: async (i) => {
      const tavily = gw.vault.get("TAVILY_API_KEY");
      const brave = gw.vault.get("BRAVE_API_KEY");
      if (tavily) return { provider: "tavily", results: await searchTavily(tavily, i.query, i.maxResults) };
      if (brave) return { provider: "brave", results: await searchBrave(brave, i.query, i.maxResults) };
      return {
        error: "No web search provider configured.",
        hint: "Store TAVILY_API_KEY or BRAVE_API_KEY in the secret vault (`localant secrets set TAVILY_API_KEY`) to enable websearch.",
      };
    },
  });
}

interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (data.results ?? []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}

async function searchBrave(apiKey: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const res = await fetch(url, { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}
