import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import skill from "../src/index";

const ctxBase = { getSecret: async () => undefined, log: () => {} };
let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "article-skill-"));
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

describe("article-publisher skill", () => {
  it("declares the expected tools", () => {
    expect(skill.name).toBe("article-publisher");
    for (const t of [
      "article_create",
      "zenn_create_article",
      "zenn_list_articles",
      "zenn_publish_article",
      "zenn_create_pr",
      "qiita_create_private_article",
      "qiita_list_articles",
      "qiita_publish_article",
      "note_create_draft",
    ]) {
      expect(skill.tools[t], `missing tool ${t}`).toBeDefined();
    }
  });

  it("writes a generic draft into the workspace", async () => {
    const out = (await skill.tools.article_create!.handler(
      { title: "Hello World", body: "content", tags: ["a", "b"] },
      { ...ctxBase, workspaceDir: ws },
    )) as { path: string };
    expect(fs.existsSync(out.path)).toBe(true);
    expect(fs.readFileSync(out.path, "utf8")).toContain('title: "Hello World"');
  });

  it("creates a Zenn draft with published:false then flips it", async () => {
    const created = (await skill.tools.zenn_create_article!.handler(
      { repoPath: ws, title: "My Post", body: "body", emoji: "📝", type: "tech", topics: ["ts"] },
      { ...ctxBase, workspaceDir: ws },
    )) as { path: string; slug: string };
    expect(fs.readFileSync(created.path, "utf8")).toContain("published: false");

    const listed = (await skill.tools.zenn_list_articles!.handler(
      { repoPath: ws },
      { ...ctxBase, workspaceDir: ws },
    )) as { articles: string[] };
    expect(listed.articles).toContain(`${created.slug}.md`);

    const published = (await skill.tools.zenn_publish_article!.handler(
      { repoPath: ws, slug: created.slug },
      { ...ctxBase, workspaceDir: ws },
    )) as { published: boolean };
    expect(published.published).toBe(true);
    expect(fs.readFileSync(created.path, "utf8")).toContain("published: true");
  });

  it("fails Qiita calls when the secret is missing", async () => {
    await expect(
      skill.tools.qiita_list_articles!.handler({}, { ...ctxBase, workspaceDir: ws }),
    ).rejects.toThrow(/QIITA_TOKEN/);
  });

  it("validates input schemas", () => {
    expect(() => skill.tools.zenn_list_articles!.inputSchema.parse({})).toThrow();
  });
});
