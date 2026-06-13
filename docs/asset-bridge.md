# Asset Bridge

The Asset Bridge gets an **image produced or referenced in a ChatGPT
conversation onto the local repo** — the missing half of the LocalAnt loop. The
assistant can read a repo and write code, but until now it had no reliable way
to land a *generated or attached image* (an icon, a diagram, a screenshot) as a
real file on disk.

It is a **single tool**, `asset_save_image`. There is no single *route* that
always works, so the tool's `source` discriminator selects how the bytes arrive;
the assistant picks whichever fits the situation. All routes share one
validation + write path.

## Usage

```jsonc
asset_save_image {
  "source": { "kind": "base64" | "url" | "latest_download", … },
  "destination": "assets/icon.png",
  "overwrite": false
}
```

### `source.kind`

| kind | fields | user action | best for |
|------|--------|-------------|----------|
| `base64` | `data` (base64), `sha256?` | none | a small image the assistant can read directly |
| `url` | `url` | paste a URL | a reachable public image URL |
| `latest_download` | `sinceSeconds?` (default 600), `allowedExtensions?` | click "download" | any image — the most reliable fallback |

- **base64** carries the bytes inline. Great for icons/diagrams. For images of
  several MB, prefer `url` or `latest_download` rather than emitting a huge
  base64 blob.
- **url** is `http(s)` only and **SSRF-guarded**: localhost, loopback, private,
  link-local, CGNAT, and metadata addresses are rejected (both for the literal
  host and for every resolved DNS address), redirects are followed manually and
  re-validated (max 3), and the size limit is enforced against both
  `Content-Length` and the bytes actually read.
- **latest_download** scans the Downloads folder for the newest matching image.
  `sinceSeconds` bounds how stale a file may be; the directory can be overridden
  with `assets.downloadsDir` in the config.

Returns `{ path, bytes, mimeType, sha256, source, backupId? }`.

## Validation (every route)

Before anything is written, the resolved bytes must pass:

1. **Size ceiling** — `assets.maxAssetBytes` (default 25 MiB).
2. **Checksum** — if a `sha256` was provided, it must match.
3. **Magic-byte sniff** — content must actually be PNG / JPEG / WebP / GIF / SVG.
   The caller-declared MIME/extension is never trusted.
4. **MIME allowlist** — `assets.allowedMimeTypes`.
5. **SVG safety** — SVGs containing `<script>`, `on*=` event handlers,
   `javascript:`, `<foreignObject>`, `<iframe>`, or entity declarations are
   rejected.
6. **PathGuard** — the destination is resolved and checked like any other write
   (sensitive blocklist always; allowlist too in `strict` mode). A backup is
   kept when overwriting.

The file is written via a temp file + atomic rename, so a partial/failed write
never leaves a corrupt asset in place.

## Security notes

- **Audit log never stores base64.** The tool's `auditInput` sanitizer records
  the source's `base64Len` instead of the payload itself.
- In the default `open` mode `asset_save_image` is risk 2 and runs **without
  approval** (only risk-4 actions prompt), so the common "generate → adopt" flow
  needs no clicks. In `strict` mode it requires approval like any other file
  modification.

## Configuration

```jsonc
// ~/.localant/config.json
{
  "assets": {
    "maxAssetBytes": 26214400,        // 25 MiB
    "allowedMimeTypes": ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
    "downloadsDir": null               // defaults to ~/Downloads
  }
}
```

## Profiles

`asset_save_image` is exposed in the `coding` and `full` profiles (not
`minimal`).

```bash
localant tools profile coding
```
