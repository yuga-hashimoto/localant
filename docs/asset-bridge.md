# Asset Bridge

The Asset Bridge gets an **image produced or referenced in a ChatGPT
conversation onto the local repo** — the missing half of the LocalAnt loop. The
assistant can read a repo and write code, but until now it had no reliable way
to land a *generated or attached image* (an icon, a diagram, a screenshot) as a
real file on disk.

There is no single route that always works, so the bridge offers three that
share one validation + write path. The assistant picks whichever fits the
situation; you usually do nothing.

## Routes

| Route | Tool(s) | User action | Best for |
|-------|---------|-------------|----------|
| base64 chunk relay | `asset_receive_start` → `asset_receive_chunk` → `asset_receive_commit` | none | An image the assistant can read directly and stream in. |
| URL import | `asset_import_url` | paste a URL | A reachable public image URL. |
| latest download | `asset_import_latest_download` | click "download" | Any image — the most reliable fallback. |

### 1. base64 chunk relay

When the assistant can read the image bytes itself, it streams them in base64
chunks (so a large image never has to fit in a single tool call):

```text
asset_receive_start  { fileName, totalBytes, destination, sha256?, overwrite? }
  → { transferId, chunkSizeHint }      # chunkSizeHint ≈ 48 KB of raw bytes
asset_receive_chunk  { transferId, index: 0, dataBase64 }
asset_receive_chunk  { transferId, index: 1, dataBase64 }
  …
asset_receive_commit { transferId }    # reassemble → validate → atomic write
```

Chunks are 0-indexed and must be contiguous. On commit the bridge reassembles
the buffer, checks size and (if provided) the sha256, sniffs the image type,
runs SVG safety checks, and writes the file atomically (keeping a backup on
overwrite). `asset_receive_abort { transferId }` drops an in-progress transfer.

### 2. URL import

```text
asset_import_url { url, destination, overwrite? }
```

`url` must be `http(s)`. The fetch is **SSRF-guarded**: localhost,
loopback/private/link-local/CGNAT/metadata addresses are rejected (both for the
literal host and for every resolved DNS address), redirects are followed
manually and re-validated (max 3), and the size limit is enforced against both
`Content-Length` and the bytes actually read.

### 3. latest download

```text
asset_import_latest_download { destination, sinceSeconds?, allowedExtensions?, overwrite? }
```

Scans the Downloads folder for the newest matching image and adopts it. Use it
right after downloading an image from ChatGPT. `sinceSeconds` (default 600)
bounds how stale a file may be; the directory can be overridden with
`assets.downloadsDir` in the config.

## Validation (every route)

Before anything is written, the decoded bytes must pass:

1. **Size ceiling** — `assets.maxAssetBytes` (default 25 MiB).
2. **Checksum** — if a `sha256` was declared, it must match.
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

- **Audit log never stores base64.** `asset_receive_chunk` records only
  `{ transferId, index, base64Len }` — the payload itself is excluded via the
  tool's `auditInput` sanitizer.
- In the default `open` mode these tools are risk 1–2 and run **without
  approval** (only risk-4 actions prompt), so the common "generate → adopt"
  flow needs no clicks. In `strict` mode the risk-2 commit/import steps require
  approval like any other file modification.

## Configuration

```jsonc
// ~/.localant/config.json
{
  "assets": {
    "maxAssetBytes": 26214400,        // 25 MiB
    "transferTtlMs": 300000,          // in-progress transfers expire after 5 min
    "allowedMimeTypes": ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
    "downloadsDir": null               // defaults to ~/Downloads
  }
}
```

## Profiles

Asset tools are exposed in the `coding` and `full` profiles (not `minimal`).

```bash
localant tools profile coding
```
