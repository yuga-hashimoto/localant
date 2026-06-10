import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { execFileSafe } from "../util/exec.js";
import type { Gateway } from "../gateway.js";

interface ArticleConfig {
  zennRepo?: string;
  noteEnabled?: boolean;
}

function loadArticleConfig(gw: Gateway): ArticleConfig {
  const f = path.join(gw.paths.root, "articles.json");
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as ArticleConfig;
  } catch {
    return {};
  }
}
function saveArticleConfig(gw: Gateway, cfg: ArticleConfig): void {
  fs.writeFileSync(path.join(gw.paths.root, "articles.json"), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || `article-${Date.now()}`;
}

export function registerArticleTools(gw: Gateway): void {
  const r = gw.registry;

  // ---- generic ----
  r.register({
    name: "article_create",
    description: "Create a generic Markdown article draft in the workspace.",
    risk: 1,
    inputSchema: z.object({ title: z.string(), body: z.string(), tags: z.array(z.string()).default([]) }),
    summarize: (i) => `draft article '${i.title}'`,
    handler: (i) => {
      const file = path.join(gw.paths.workspaceDir, `${slugify(i.title)}.md`);
      const fm = `---\ntitle: "${i.title}"\ntags: [${i.tags.map((t) => `"${t}"`).join(", ")}]\n---\n\n`;
      fs.writeFileSync(file, fm + i.body);
      return { path: file };
    },
  });

  // ---- Zenn (GitHub repo method) ----
  r.register({
    name: "zenn_configure_repo",
    description: "Set the local Zenn content repo path (must be inside an allowed directory).",
    risk: 1,
    inputSchema: z.object({ repoPath: z.string() }),
    handler: (i) => {
      const resolved = gw.pathGuard.assertAccess(i.repoPath, "write");
      saveArticleConfig(gw, { ...loadArticleConfig(gw), zennRepo: resolved });
      return { zennRepo: resolved };
    },
  });
  r.register({
    name: "zenn_create_article",
    description: "Create a Zenn article markdown file (published:false draft) in the configured repo.",
    risk: 2,
    inputSchema: z.object({ slug: z.string().optional(), title: z.string(), emoji: z.string().default("📝"), type: z.enum(["tech", "idea"]).default("tech"), topics: z.array(z.string()).default([]), body: z.string() }),
    summarize: (i) => `zenn draft '${i.title}'`,
    handler: (i) => {
      const repo = loadArticleConfig(gw).zennRepo;
      if (!repo) throw new Error("Run zenn_configure_repo first.");
      const slug = i.slug ?? slugify(i.title);
      const dir = path.join(repo, "articles");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${slug}.md`);
      const fm = `---\ntitle: "${i.title}"\nemoji: "${i.emoji}"\ntype: "${i.type}"\ntopics: [${i.topics.map((t) => `"${t}"`).join(", ")}]\npublished: false\n---\n\n`;
      fs.writeFileSync(file, fm + i.body);
      return { path: file, slug, published: false };
    },
  });
  r.register({
    name: "zenn_list_articles",
    description: "List Zenn article files in the configured repo.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const repo = loadArticleConfig(gw).zennRepo;
      if (!repo) throw new Error("Run zenn_configure_repo first.");
      const dir = path.join(repo, "articles");
      return { articles: fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [] };
    },
  });
  r.register({
    name: "zenn_publish_article",
    description: "Flip a Zenn article to published:true. Publishing is risk 4 (double approval).",
    risk: 4,
    inputSchema: z.object({ slug: z.string() }),
    summarize: (i) => `PUBLISH zenn ${i.slug}`,
    handler: (i) => {
      const repo = loadArticleConfig(gw).zennRepo;
      if (!repo) throw new Error("Run zenn_configure_repo first.");
      const file = path.join(repo, "articles", `${i.slug}.md`);
      const content = fs.readFileSync(file, "utf8").replace(/published:\s*false/, "published: true");
      fs.writeFileSync(file, content);
      return { path: file, published: true, note: "Commit & push the repo to publish on Zenn." };
    },
  });
  r.register({
    name: "zenn_create_pr",
    description: "Commit Zenn changes on a new branch (ready to push and open a PR).",
    risk: 3,
    inputSchema: z.object({ branch: z.string(), message: z.string() }),
    summarize: (i) => `zenn PR branch ${i.branch}`,
    handler: async (i) => {
      const repo = loadArticleConfig(gw).zennRepo;
      if (!repo) throw new Error("Run zenn_configure_repo first.");
      await gw.git.createBranch(repo, i.branch);
      await gw.git.commit(repo, i.message, true);
      return { branch: i.branch, note: `Push with: git -C ${repo} push -u origin ${i.branch}` };
    },
  });

  // ---- Qiita (official API) ----
  r.register({
    name: "qiita_configure_token",
    description: "Store the Qiita API token in the secret vault under QIITA_TOKEN.",
    risk: 2,
    inputSchema: z.object({ token: z.string().min(10) }),
    summarize: () => "store QIITA_TOKEN",
    handler: (i) => {
      gw.vault.set("QIITA_TOKEN", i.token);
      return { stored: "QIITA_TOKEN" };
    },
  });
  r.register({
    name: "qiita_create_private_article",
    description: "Create a PRIVATE Qiita article via the official API.",
    risk: 3,
    inputSchema: z.object({ title: z.string(), body: z.string(), tags: z.array(z.string()).default([]) }),
    summarize: (i) => `qiita private '${i.title}'`,
    handler: async (i) => {
      const token = gw.vault.get("QIITA_TOKEN");
      if (!token) throw new Error("QIITA_TOKEN not set. Run qiita_configure_token.");
      const res = await fetch("https://qiita.com/api/v2/items", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: i.title, body: i.body, private: true, tags: (i.tags.length ? i.tags : ["draft"]).map((name) => ({ name })) }),
      });
      if (!res.ok) throw new Error(`Qiita API error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { id: string; url: string };
      return { id: json.id, url: json.url, private: true };
    },
  });
  r.register({
    name: "qiita_list_articles",
    description: "List your authenticated Qiita articles.",
    risk: 3,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      const token = gw.vault.get("QIITA_TOKEN");
      if (!token) throw new Error("QIITA_TOKEN not set.");
      const res = await fetch("https://qiita.com/api/v2/authenticated_user/items?per_page=20", { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Qiita API error ${res.status}`);
      const items = (await res.json()) as { id: string; title: string; private: boolean; url: string }[];
      return { items: items.map((it) => ({ id: it.id, title: it.title, private: it.private, url: it.url })) };
    },
  });
  r.register({
    name: "qiita_publish_article",
    description: "Flip a Qiita article to public. Publishing is risk 4 (double approval).",
    risk: 4,
    inputSchema: z.object({ id: z.string() }),
    summarize: (i) => `PUBLISH qiita ${i.id}`,
    handler: async (i) => {
      const token = gw.vault.get("QIITA_TOKEN");
      if (!token) throw new Error("QIITA_TOKEN not set.");
      const res = await fetch(`https://qiita.com/api/v2/items/${i.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ private: false }),
      });
      if (!res.ok) throw new Error(`Qiita API error ${res.status}: ${await res.text()}`);
      return { id: i.id, private: false };
    },
  });

  // ---- note (draft-first, adapter) ----
  r.register({
    name: "note_create_draft",
    description: "Create a local note draft (note has no official public API; drafts are kept locally).",
    risk: 1,
    inputSchema: z.object({ title: z.string(), body: z.string() }),
    summarize: (i) => `note draft '${i.title}'`,
    handler: (i) => {
      const file = path.join(gw.paths.workspaceDir, `note-${slugify(i.title)}.md`);
      fs.writeFileSync(file, `# ${i.title}\n\n${i.body}`);
      return { path: file, note: "note has no official write API; publish manually or via the note-mcp adapter." };
    },
  });
  r.register({
    name: "note_configure",
    description: "Register a note-mcp server via the MCP bridge for note.com publishing.",
    risk: 2,
    inputSchema: z.object({ mcpServerName: z.string().default("note-mcp") }),
    handler: (i) => {
      const s = gw.config().mcpServers[i.mcpServerName];
      if (!s) throw new Error(`MCP server '${i.mcpServerName}' not registered. Register it first via mcp_server_register.`);
      return { configured: i.mcpServerName, toolList: `Use mcp_server_list_tools to discover note tools.` };
    },
  });
  r.register({
    name: "note_publish_article",
    description: "Publish a note article via a configured note-mcp bridge. Risk 4 (double approval).",
    risk: 4,
    inputSchema: z.object({ draftPath: z.string(), serverName: z.string().default("note-mcp") }),
    summarize: (i) => `PUBLISH note ${i.draftPath}`,
    handler: async (i) => {
      const s = gw.config().mcpServers[i.serverName];
      if (!s) throw new Error(`MCP server '${i.serverName}' not registered. Register note-mcp via mcp_server_register, then retry.`);
      if (!s.enabled) throw new Error(`MCP server '${i.serverName}' is disabled. Enable it, then retry.`);
      const server = await gw.bridge.listTools(i.serverName);
      const publishTool = server.find((t) => t.name.includes("publish") || t.name.includes("create"));
      if (!publishTool) throw new Error(`No publish tool found on '${i.serverName}'. Available tools: ${server.map((t) => t.name).join(", ")}`);
      const content = fs.readFileSync(i.draftPath, "utf8");
      const lines = content.split("\n");
      const title = lines[0]?.replace(/^#\s*/, "") ?? "Draft";
      const body = lines.slice(1).join("\n").trim();
      return gw.bridge.callTool(i.serverName, publishTool.name, { title, body });
    },
  });

  void execFileSafe;
}
