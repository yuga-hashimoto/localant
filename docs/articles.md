# Article Publishing

Create and publish articles to Zenn, Qiita, and note. Publish actions are
**risk 4 (double approval)**.

## Zenn (GitHub-repo method)

Zenn publishes from a connected GitHub repo of Markdown files.

```
zenn_configure_repo({ repoPath: "~/Projects/zenn-content" })   # must be in an allowed dir
zenn_create_article({ title, emoji, type, topics, body })       # published:false draft
zenn_list_articles()
zenn_publish_article({ slug })                                   # flips published:true (risk 4)
zenn_create_pr({ branch, message })                             # commit on a branch to PR
```

After publishing, commit & push the repo to deploy on Zenn.

## Qiita (official API)

```
qiita_configure_token({ token })          # stored as QIITA_TOKEN in the vault
qiita_create_private_article({ title, body, tags })   # private=true
qiita_list_articles()
qiita_publish_article({ id })             # private=false (risk 4)
```

## note (draft-first)

note has no official public write API. Drafts are created locally; publishing
requires a configured note-mcp adapter.

```
note_create_draft({ title, body })        # local Markdown draft
note_publish_article({ draftPath })        # requires note-mcp adapter (risk 4)
```

## Generic

`article_create({ title, body, tags })` writes a generic Markdown draft to the
workspace.
