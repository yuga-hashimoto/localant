# Article Publisher (LocalAnt skill)

Draft and publish articles to **Zenn** (GitHub repo method), **Qiita** (official API),
and **note** / generic local drafts. This is the skill replacement for the former
built-in `zenn_*` / `qiita_*` / `note_*` / `article_create` tools.

## Tools

| Tool | Notes |
|------|-------|
| `article_create` | Generic Markdown draft in the skill workspace. |
| `zenn_create_article` | Draft (`published:false`) under `<repoPath>/articles`. |
| `zenn_list_articles` | List article files in the repo. |
| `zenn_publish_article` | Flip `published:true` (then commit & push to publish). |
| `zenn_create_pr` | Commit changes on a new branch (`git` on PATH). |
| `qiita_create_private_article` | Create a private Qiita article. |
| `qiita_list_articles` | List your Qiita articles. |
| `qiita_publish_article` | Make a Qiita article public. |
| `note_create_draft` | Local note draft (note has no official write API). |

## Setup

1. **Qiita token** — store it as a secret named `QIITA_TOKEN` (dashboard → Secrets,
   or `localant secrets set QIITA_TOKEN`). The skill reads it via `getSecret`; it is
   never written by the skill. This replaces the old `qiita_configure_token` tool.
2. **Zenn repo** — pass `repoPath` (your local Zenn content repo) on each Zenn call.
   This replaces the old `zenn_configure_repo` tool.
3. Enable the skill (skills are disabled by default), then call via `skill_run`:

   ```
   skill_run { name: "article-publisher", tool: "qiita_list_articles", input: {} }
   ```

## Differences from the old built-in tools

- `qiita_configure_token` → use standard secret management (`QIITA_TOKEN`).
- `zenn_configure_repo` → pass `repoPath` per call (stateless).
- `note_configure` / `note_publish_article` were thin MCP-bridge shims and are **not**
  ported — note has no official public write API; publish manually or via an MCP bridge.
- Publish actions ran at risk 4 (double approval) as built-ins; as a skill they run
  under `skill_run` (risk 3). Review before enabling.
