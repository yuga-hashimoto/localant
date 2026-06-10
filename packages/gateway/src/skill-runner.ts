/**
 * Isolated skill execution entry point. Reads a JSON payload from stdin,
 * dynamically imports the skill entry (Node strips TS types on v22.18+),
 * validates input against the tool's Zod schema, runs the handler with a
 * restricted context, and prints a single JSON result line to stdout.
 *
 * The skill only receives the secret values it is permitted to access; the
 * vault itself is never exposed to the subprocess.
 */
import { pathToFileURL } from "node:url";

interface Payload {
  entry: string;
  tool: string;
  input: unknown;
  secrets: Record<string, string>;
  workspaceDir: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const payload = JSON.parse(await readStdin()) as Payload;
  const mod = await import(pathToFileURL(payload.entry).href);
  const skill = mod.default;
  if (!skill || !skill.tools || !skill.tools[payload.tool]) {
    throw new Error(`Tool '${payload.tool}' not found in skill.`);
  }
  const tool = skill.tools[payload.tool];
  const parsed = tool.inputSchema ? tool.inputSchema.parse(payload.input) : payload.input;
  const ctx = {
    getSecret: async (name: string) => payload.secrets[name],
    workspaceDir: payload.workspaceDir,
    log: (msg: string) => process.stderr.write(`[skill] ${msg}\n`),
  };
  const result = await tool.handler(parsed, ctx);
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
}

main().catch((err: unknown) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + "\n");
  process.exitCode = 1;
});
