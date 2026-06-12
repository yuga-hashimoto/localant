import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Gateway } from "../gateway.js";

export function registerFilesystemTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "fs_list_allowed_directories",
    description:
      "List filesystem access policy. In 'strict' mode access is limited to the returned directories; in 'open'/'yolo' mode there is no directory restriction (only the sensitive blocklist applies) and you may read/write anywhere outside it.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => {
      const mode = gw.config().security.mode;
      const allowed = gw.pathGuard.allowed();
      if (mode === "strict") {
        return { mode, restricted: true, allowed };
      }
      return {
        mode,
        restricted: false,
        note: `Filesystem access is NOT restricted to these directories in '${mode}' mode. Only the sensitive blocklist (credentials, system paths) is enforced — you may read and write anywhere outside it. The list below is only a hint of common project locations.`,
        allowed,
      };
    },
  });

  r.register({
    name: "fs_add_allowed_directory",
    description: "Add a directory to the filesystem allowlist.",
    risk: 2,
    inputSchema: z.object({ path: z.string() }),
    summarize: (i) => `allow directory ${i.path}`,
    handler: (i) => {
      const cfg = gw.config();
      const dirs = Array.from(new Set([...cfg.security.allowedDirectories, i.path]));
      gw.saveConfig({ ...cfg, security: { ...cfg.security, allowedDirectories: dirs } });
      return { allowed: gw.pathGuard.allowed() };
    },
  });

  r.register({
    name: "fs_remove_allowed_directory",
    description: "Remove a directory from the filesystem allowlist.",
    risk: 2,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => {
      const cfg = gw.config();
      const dirs = cfg.security.allowedDirectories.filter((d) => d !== i.path);
      gw.saveConfig({ ...cfg, security: { ...cfg.security, allowedDirectories: dirs } });
      return { allowed: gw.pathGuard.allowed() };
    },
  });

  r.register({
    name: "fs_list_files",
    description: "List files in a directory inside the allowlist.",
    risk: 0,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => gw.fs.listFiles(i.path),
  });

  r.register({
    name: "fs_read_file",
    description: "Read a text file inside the allowlist. If the file is an image (PNG, JPEG, GIF, WebP, SVG), it will be automatically read and returned as an image block.",
    risk: 0,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => {
      const resolved = gw.pathGuard.assertAccess(i.path, "read");
      const stat = fs.statSync(resolved);
      const limit = gw.config().security.maxFileSizeBytes;
      if (stat.size > limit) {
        throw new Error(`File too large (${stat.size} bytes > ${limit} limit).`);
      }
      const ext = path.extname(resolved).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext);
      if (isImage) {
        let mimeType = "image/png";
        if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
        else if (ext === ".gif") mimeType = "image/gif";
        else if (ext === ".webp") mimeType = "image/webp";
        else if (ext === ".svg") mimeType = "image/svg+xml";

        const base64 = fs.readFileSync(resolved).toString("base64");
        return {
          path: i.path,
          __image: { mimeType, base64 },
        };
      }
      return { path: i.path, content: gw.fs.readFile(i.path) };
    },
  });

  r.register({
    name: "fs_read_image",
    description: "Read an image file (PNG, JPEG, GIF, WebP, SVG) inside the allowlist and return it as an image block.",
    risk: 0,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => {
      const resolved = gw.pathGuard.assertAccess(i.path, "read");
      const stat = fs.statSync(resolved);
      const limit = gw.config().security.maxFileSizeBytes;
      if (stat.size > limit) {
        throw new Error(`File too large (${stat.size} bytes > ${limit} limit).`);
      }
      const ext = path.extname(resolved).toLowerCase();
      let mimeType = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
      else if (ext === ".gif") mimeType = "image/gif";
      else if (ext === ".webp") mimeType = "image/webp";
      else if (ext === ".svg") mimeType = "image/svg+xml";

      const base64 = fs.readFileSync(resolved).toString("base64");
      return {
        path: i.path,
        __image: { mimeType, base64 },
      };
    },
  });

  r.register({
    name: "fs_read_file_range",
    description: "Read a line range from a file (1-indexed, inclusive).",
    risk: 0,
    inputSchema: z.object({ path: z.string(), startLine: z.number().int().min(1), endLine: z.number().int().min(1) }),
    handler: (i) => ({ path: i.path, content: gw.fs.readRange(i.path, i.startLine, i.endLine) }),
  });

  r.register({
    name: "fs_search_files",
    description: "Find files by glob pattern under a directory.",
    risk: 0,
    inputSchema: z.object({ path: z.string(), pattern: z.string(), limit: z.number().int().min(1).max(1000).default(200) }),
    handler: (i) => ({ matches: gw.fs.searchFiles(i.path, i.pattern, i.limit) }),
  });

  r.register({
    name: "fs_search_content",
    description: "Search file contents for a substring under a directory.",
    risk: 0,
    inputSchema: z.object({ path: z.string(), query: z.string(), limit: z.number().int().min(1).max(1000).default(200) }),
    handler: (i) => ({ matches: gw.fs.searchContent(i.path, i.query, i.limit) }),
  });

  r.register({
    name: "fs_get_file_info",
    description: "Get metadata for a file or directory.",
    risk: 0,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => gw.fs.getInfo(i.path),
  });

  r.register({
    name: "fs_write_draft_file",
    description: "Create a NEW draft file. Refuses to overwrite existing files.",
    risk: 1,
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    summarize: (i) => `write draft ${i.path}`,
    handler: (i) => gw.fs.writeDraft(i.path, i.content),
  });

  r.register({
    name: "fs_create_file",
    description: "Create a file, optionally overwriting (a backup is kept on overwrite).",
    risk: 2,
    inputSchema: z.object({ path: z.string(), content: z.string(), overwrite: z.boolean().default(false) }),
    summarize: (i) => `create file ${i.path}${i.overwrite ? " (overwrite)" : ""}`,
    handler: (i) => gw.fs.createFile(i.path, i.content, i.overwrite),
  });

  r.register({
    name: "fs_apply_patch_with_backup",
    description: "Replace an existing file's contents, keeping a backup.",
    risk: 2,
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    summarize: (i) => `patch file ${i.path}`,
    handler: (i) => gw.fs.applyPatchWithBackup(i.path, i.content),
  });

  r.register({
    name: "fs_move_file",
    description: "Move/rename a file within the allowlist.",
    risk: 2,
    inputSchema: z.object({ from: z.string(), to: z.string() }),
    summarize: (i) => `move ${i.from} -> ${i.to}`,
    handler: (i) => gw.fs.moveFile(i.from, i.to),
  });

  r.register({
    name: "fs_delete_file_with_approval",
    description: "Delete a file (a backup is kept). Requires approval.",
    risk: 3,
    inputSchema: z.object({ path: z.string() }),
    summarize: (i) => `delete file ${i.path}`,
    handler: (i) => gw.fs.deleteFile(i.path),
  });

  r.register({
    name: "fs_backup_file",
    description: "Create a backup of a file.",
    risk: 1,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => gw.fs.backup(i.path),
  });

  r.register({
    name: "fs_restore_backup",
    description: "Restore a previously created backup by id.",
    risk: 2,
    inputSchema: z.object({ id: z.string() }),
    summarize: (i) => `restore backup ${i.id}`,
    handler: (i) => gw.fs.restoreBackup(i.id),
  });

  r.register({
    name: "fs_list_backups",
    description: "List available file backups.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: () => gw.fs.listBackups(),
  });
}
