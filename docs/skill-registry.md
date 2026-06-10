# Skill Registry

There is no central server. Skills are shared via Git, inspired by ClawHub but
decentralized.

## Install from Git

```bash
localant skills install https://github.com/user/my-skill
```

or the `skill_install_from_git` tool. The repo is cloned into the skills
directory and saved **disabled**. Review its permissions, validate, then enable.

## Registry index format

Point `config.skillRegistry.sources` at one or more `registry.json` URLs:

```json
{
  "skills": [
    {
      "name": "qiita-private-post",
      "repo": "https://github.com/user/qiita-private-post-skill",
      "description": "Post private articles to Qiita",
      "version": "0.1.0",
      "permissions": { "network": ["qiita.com"], "secrets": ["QIITA_TOKEN"] }
    }
  ]
}
```

Search with `skill_search_registry({ query })`.

## Publishing requirements

A publishable skill must include: `skill.json`, `README.md`, `LICENSE`,
permissions, risk level, tests, examples, version, and a CHANGELOG.
`skill_publish_to_git` validates the skill, then `git init/add/commit` it and
(optionally) adds a remote — push with `git push -u origin main`.
