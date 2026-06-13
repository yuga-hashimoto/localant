import fs from "node:fs";
import path from "node:path";
import { defineSkill, z } from "@localant/skill-sdk";

/**
 * File Organizer — sort a folder's loose files into subfolders. ChatGPT can
 * decide *that* your Downloads folder is a mess, but only local hands can move
 * the files. This skill is the hands.
 *
 * Two modes:
 *   - "type": group by file extension (images/, documents/, archives/, …)
 *   - "date": group by year-month of the file's last-modified time (2026-06/)
 */

const TYPE_BUCKETS: Record<string, string> = {
  ".jpg": "images",
  ".jpeg": "images",
  ".png": "images",
  ".gif": "images",
  ".webp": "images",
  ".heic": "images",
  ".pdf": "documents",
  ".doc": "documents",
  ".docx": "documents",
  ".txt": "documents",
  ".md": "documents",
  ".xls": "spreadsheets",
  ".xlsx": "spreadsheets",
  ".csv": "spreadsheets",
  ".zip": "archives",
  ".tar": "archives",
  ".gz": "archives",
  ".rar": "archives",
  ".7z": "archives",
  ".mp4": "video",
  ".mov": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".dmg": "installers",
  ".pkg": "installers",
};

function bucketByType(file: string): string {
  return TYPE_BUCKETS[path.extname(file).toLowerCase()] ?? "other";
}

function bucketByDate(absPath: string): string {
  const mtime = fs.statSync(absPath).mtime;
  const month = String(mtime.getMonth() + 1).padStart(2, "0");
  return `${mtime.getFullYear()}-${month}`;
}

interface Move {
  from: string;
  to: string;
}

/** Compute the moves for top-level files in `dir`. Subdirectories and dotfiles
 * are left untouched so we never recurse into already-organized folders. */
function planMoves(dir: string, by: "type" | "date"): Move[] {
  const moves: Move[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const abs = path.join(dir, name);
    if (!fs.statSync(abs).isFile()) continue;
    const bucket = by === "date" ? bucketByDate(abs) : bucketByType(name);
    moves.push({ from: abs, to: path.join(dir, bucket, name) });
  }
  return moves;
}

function assertDir(dir: string): string {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }
  return resolved;
}

export default defineSkill({
  name: "file-organizer",
  displayName: "File Organizer",
  description: "Sort a local folder's files into subfolders by type or date.",
  version: "0.1.0",
  tools: {
    file_organizer_plan: {
      description: "Preview how files in a directory would be organized (no changes made).",
      riskLevel: 0,
      inputSchema: z.object({ dir: z.string(), by: z.enum(["type", "date"]).default("type") }),
      handler: ({ dir, by }) => {
        const resolved = assertDir(dir);
        const moves = planMoves(resolved, by);
        return {
          dir: resolved,
          by,
          count: moves.length,
          moves: moves.map((m) => ({ file: path.basename(m.from), into: path.basename(path.dirname(m.to)) })),
        };
      },
    },
    file_organizer_apply: {
      description: "Move files in a directory into subfolders by type or date.",
      riskLevel: 2,
      inputSchema: z.object({ dir: z.string(), by: z.enum(["type", "date"]).default("type") }),
      handler: ({ dir, by }, ctx) => {
        const resolved = assertDir(dir);
        const moves = planMoves(resolved, by);
        let moved = 0;
        for (const m of moves) {
          fs.mkdirSync(path.dirname(m.to), { recursive: true });
          // Skip rather than clobber if a same-named file already sits in the bucket.
          if (fs.existsSync(m.to)) continue;
          fs.renameSync(m.from, m.to);
          moved++;
        }
        ctx.log(`organized ${moved}/${moves.length} files in ${resolved} by ${by}`);
        return { dir: resolved, by, moved, skipped: moves.length - moved };
      },
    },
  },
});
