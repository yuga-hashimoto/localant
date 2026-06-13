import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { defineSkill, z } from "@localant/skill-sdk";

const exec = promisify(execFile);

/**
 * Local Backup — snapshot a folder into a timestamped `.tar.gz`. Backing up the
 * files on your machine is exactly the kind of local-only chore ChatGPT can ask
 * for but cannot do; this skill provides the hands.
 *
 * `tar` is invoked with an argv array (never a shell string), so paths with
 * spaces are safe and there is no command injection surface.
 */

function assertDir(dir: string): string {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}

/** Timestamp like 20260613-114512, safe for filenames across platforms. */
function stamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

export default defineSkill({
  name: "local-backup",
  displayName: "Local Backup",
  description: "Create and list timestamped .tar.gz snapshots of a local folder.",
  version: "0.1.0",
  tools: {
    local_backup_create: {
      description: "Create a timestamped .tar.gz snapshot of a directory.",
      riskLevel: 2,
      inputSchema: z.object({ dir: z.string(), outDir: z.string().optional() }),
      handler: async ({ dir, outDir }, ctx) => {
        const source = assertDir(dir);
        const dest = outDir ? path.resolve(outDir) : ctx.workspaceDir;
        fs.mkdirSync(dest, { recursive: true });
        const base = path.basename(source) || "backup";
        const archive = path.join(dest, `${base}-${stamp()}.tar.gz`);
        // -C parent + basename keeps the archive rooted at the folder, not the
        // absolute path, so it restores cleanly anywhere.
        await exec("tar", ["-czf", archive, "-C", path.dirname(source), path.basename(source)], {
          maxBuffer: 10_000_000,
        });
        const size = fs.statSync(archive).size;
        ctx.log(`backed up ${source} -> ${archive} (${size} bytes)`);
        return { source, archive, bytes: size };
      },
    },
    local_backup_list: {
      description: "List backup archives previously created in the workspace (or a given output dir).",
      riskLevel: 0,
      inputSchema: z.object({ outDir: z.string().optional() }),
      handler: ({ outDir }, ctx) => {
        const dir = outDir ? path.resolve(outDir) : ctx.workspaceDir;
        if (!fs.existsSync(dir)) return { dir, archives: [] };
        const archives = fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".tar.gz"))
          .map((f) => {
            const st = fs.statSync(path.join(dir, f));
            return { name: f, bytes: st.size, createdAt: st.mtime.toISOString() };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { dir, archives };
      },
    },
  },
});
