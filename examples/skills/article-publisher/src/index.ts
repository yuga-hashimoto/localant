import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { defineSkill, z } from "@localant/skill-sdk";

const exec = promisify(execFile);

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || `article-${Date.now()}`
  );
}

/** Run git in a repo without a shell (args array, never interpolated). */
async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repo, ...args], { maxBuffer: 10_000_000 });
  return stdout.trim();
}

const QIITA_API = "https://qiita.com/api/v2";

async function qiitaToken(ctx: { getSecret: (n: string) => Promise<string | undefined> }): Promise<string> {
  const token = await ctx.getSecret("QIITA_TOKEN");
  if (!token) {
    throw new Error(
      "QIITA_TOKEN is not available. Store it via the dashboard (Secrets) or `localant secrets set QIITA_TOKEN`, " +
        "and ensure this skill's permissions.secrets includes QIITA_TOKEN.",
    );
  }
  return token;
}

export default defineSkill({
  name: "article-publisher",
  displayName: "Article Publisher",
  description: "Draft and publish articles to Zenn (git repo) and Qiita (API), plus local note/generic drafts.",
  version: "0.1.0",
  tools: {
    // ---- generic ----
    article_create: {
      description: "Create a generic Markdown article draft in the skill workspace.",
      riskLevel: 1,
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        tags: z.array(z.string()).default([]),
      }),
      handler: ({ title, body, tags }, ctx) => {
        const file = path.join(ctx.workspaceDir, `${slugify(title)}.md`);
        const fm = `---\ntitle: "${title}"\ntags: [${tags.map((t) => `"${t}"`).join(", ")}]\n---\n\n`;
        fs.writeFileSync(file, fm + body);
        return { path: file };
      },
    },

    // ---- Zenn (GitHub repo method) ----
    zenn_create_article: {
      description: "Create a Zenn article markdown file (published:false draft) under <repoPath>/articles.",
      riskLevel: 2,
      inputSchema: z.object({
        repoPath: z.string(),
        slug: z.string().optional(),
        title: z.string(),
        emoji: z.string().default("📝"),
        type: z.enum(["tech", "idea"]).default("tech"),
        topics: z.array(z.string()).default([]),
        body: z.string(),
      }),
      handler: ({ repoPath, slug, title, emoji, type, topics, body }) => {
        const finalSlug = slug ?? slugify(title);
        const dir = path.join(repoPath, "articles");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${finalSlug}.md`);
        const fm = `---\ntitle: "${title}"\nemoji: "${emoji}"\ntype: "${type}"\ntopics: [${topics
          .map((t) => `"${t}"`)
          .join(", ")}]\npublished: false\n---\n\n`;
        fs.writeFileSync(file, fm + body);
        return { path: file, slug: finalSlug, published: false };
      },
    },
    zenn_list_articles: {
      description: "List Zenn article files under <repoPath>/articles.",
      riskLevel: 0,
      inputSchema: z.object({ repoPath: z.string() }),
      handler: ({ repoPath }) => {
        const dir = path.join(repoPath, "articles");
        return { articles: fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [] };
      },
    },
    zenn_publish_article: {
      description: "Flip a Zenn article to published:true. Commit & push the repo to actually publish.",
      riskLevel: 4,
      inputSchema: z.object({ repoPath: z.string(), slug: z.string() }),
      handler: ({ repoPath, slug }) => {
        const file = path.join(repoPath, "articles", `${slug}.md`);
        const content = fs.readFileSync(file, "utf8").replace(/published:\s*false/, "published: true");
        fs.writeFileSync(file, content);
        return { path: file, published: true, note: "Commit & push the repo to publish on Zenn." };
      },
    },
    zenn_create_pr: {
      description: "Commit Zenn changes on a new branch (ready to push and open a PR).",
      riskLevel: 3,
      inputSchema: z.object({ repoPath: z.string(), branch: z.string(), message: z.string() }),
      handler: async ({ repoPath, branch, message }) => {
        await git(repoPath, ["checkout", "-b", branch]);
        await git(repoPath, ["add", "-A"]);
        await git(repoPath, ["commit", "-m", message]);
        return { branch, note: `Push with: git -C ${repoPath} push -u origin ${branch}` };
      },
    },

    // ---- Qiita (official API) ----
    qiita_create_private_article: {
      description: "Create a PRIVATE Qiita article via the official API (reads QIITA_TOKEN secret).",
      riskLevel: 3,
      inputSchema: z.object({
        title: z.string(),
        body: z.string(),
        tags: z.array(z.string()).default([]),
      }),
      handler: async ({ title, body, tags }, ctx) => {
        const token = await qiitaToken(ctx);
        const res = await fetch(`${QIITA_API}/items`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title,
            body,
            private: true,
            tags: (tags.length ? tags : ["draft"]).map((name) => ({ name })),
          }),
        });
        if (!res.ok) throw new Error(`Qiita API error ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { id: string; url: string };
        return { id: json.id, url: json.url, private: true };
      },
    },
    qiita_list_articles: {
      description: "List your authenticated Qiita articles (reads QIITA_TOKEN secret).",
      riskLevel: 3,
      inputSchema: z.object({}),
      handler: async (_input, ctx) => {
        const token = await qiitaToken(ctx);
        const res = await fetch(`${QIITA_API}/authenticated_user/items?per_page=20`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Qiita API error ${res.status}`);
        const items = (await res.json()) as { id: string; title: string; private: boolean; url: string }[];
        return { items: items.map((it) => ({ id: it.id, title: it.title, private: it.private, url: it.url })) };
      },
    },
    qiita_publish_article: {
      description: "Flip a Qiita article to public (reads QIITA_TOKEN secret).",
      riskLevel: 4,
      inputSchema: z.object({ id: z.string() }),
      handler: async ({ id }, ctx) => {
        const token = await qiitaToken(ctx);
        const res = await fetch(`${QIITA_API}/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ private: false }),
        });
        if (!res.ok) throw new Error(`Qiita API error ${res.status}: ${await res.text()}`);
        return { id, private: false };
      },
    },

    // ---- note (local draft; note has no official public write API) ----
    note_create_draft: {
      description: "Create a local note draft in the skill workspace (note has no official public write API).",
      riskLevel: 1,
      inputSchema: z.object({ title: z.string(), body: z.string() }),
      handler: ({ title, body }, ctx) => {
        const file = path.join(ctx.workspaceDir, `note-${slugify(title)}.md`);
        fs.writeFileSync(file, `# ${title}\n\n${body}`);
        return { path: file, note: "note has no official write API; publish manually." };
      },
    },
  },
});
