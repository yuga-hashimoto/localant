import path from "node:path";
import { z } from "zod";
import type { Gateway } from "../gateway.js";
import { commandExists, execFileSafe } from "../util/exec.js";

/**
 * Code-intelligence tools. Full LSP is heavy; this ships a pragmatic
 * TypeScript-first surface: `lsp_status`/`lsp_list_servers` detect available
 * language servers, `lsp_diagnostics` runs `tsc --noEmit`. The richer
 * navigation tools are declared with clear "install a language server"
 * guidance so the surface is stable for ChatGPT even before full LSP lands.
 */
export function registerLspTools(gw: Gateway): void {
  const r = gw.registry;

  r.register({
    name: "lsp_status",
    description: "Report which language servers / toolchains are available.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => ({
      typescript: await commandExists("tsc"),
      typescriptLanguageServer: await commandExists("typescript-language-server"),
      pyright: await commandExists("pyright"),
      goimports: await commandExists("gopls"),
      rustAnalyzer: await commandExists("rust-analyzer"),
    }),
  });

  r.register({
    name: "lsp_list_servers",
    description: "List known language servers and whether their binary is on PATH.",
    risk: 0,
    inputSchema: z.object({}).strip(),
    handler: async () => {
      const servers = ["typescript-language-server", "pyright", "gopls", "rust-analyzer", "clangd"];
      const out: { name: string; available: boolean }[] = [];
      for (const s of servers) out.push({ name: s, available: await commandExists(s) });
      return { servers: out };
    },
  });

  r.register({
    name: "lsp_diagnostics",
    description: "Run TypeScript diagnostics (tsc --noEmit) for a project path. Falls back to install guidance if tsc is missing.",
    risk: 0,
    inputSchema: z.object({ path: z.string().describe("Path to the project directory") }),
    handler: async (i) => {
      const dir = i.path;
      gw.pathGuard.assertAccess(dir, "read");
      if (!(await commandExists("tsc")) && !(await commandExists("npx"))) {
        return { error: "tsc not found.", hint: "Install TypeScript (`npm i -D typescript`)." };
      }
      const res = await execFileSafe("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        cwd: dir,
        timeoutMs: 120_000,
        maxOutputBytes: 200_000,
      });
      const lines = (res.stdout + res.stderr).split("\n").filter((l) => /error TS\d+/.test(l));
      return { code: res.code, diagnostics: lines.slice(0, 500), count: lines.length };
    },
  });

  // Navigation tools backed by the TypeScript LanguageService (LspService).
  r.register({
    name: "lsp_go_to_definition",
    description: "Find the definition of the symbol at a 1-indexed line/character (TypeScript/JavaScript).",
    risk: 0,
    inputSchema: z.object({ path: z.string(), line: z.number().int().min(1), character: z.number().int().min(1) }),
    handler: (i) => gw.lsp.definition(i.path, i.line, i.character),
  });
  r.register({
    name: "lsp_find_references",
    description: "Find references to the symbol at a 1-indexed line/character (TypeScript/JavaScript).",
    risk: 0,
    inputSchema: z.object({ path: z.string(), line: z.number().int().min(1), character: z.number().int().min(1) }),
    handler: (i) => gw.lsp.references(i.path, i.line, i.character),
  });
  r.register({
    name: "lsp_hover",
    description: "Get type/hover info for the symbol at a 1-indexed line/character (TypeScript/JavaScript).",
    risk: 0,
    inputSchema: z.object({ path: z.string(), line: z.number().int().min(1), character: z.number().int().min(1) }),
    handler: (i) => gw.lsp.hover(i.path, i.line, i.character),
  });
  r.register({
    name: "lsp_document_symbols",
    description: "List the symbols declared in a TypeScript/JavaScript file.",
    risk: 0,
    inputSchema: z.object({ path: z.string() }),
    handler: (i) => gw.lsp.documentSymbols(i.path),
  });
  r.register({
    name: "lsp_workspace_symbols",
    description: "Search workspace symbols (currently delegates to grep over the project).",
    risk: 0,
    inputSchema: z.object({ query: z.string(), path: z.string() }),
    handler: (i) => ({ matches: gw.fs.grep(i.path, i.query, { maxResults: 100 }) }),
  });
  r.register({
    name: "lsp_rename_symbol",
    description: "Rename the symbol at a 1-indexed line/character across the project (TypeScript/JavaScript). Risk 2.",
    risk: 2,
    inputSchema: z.object({
      path: z.string(),
      line: z.number().int().min(1),
      character: z.number().int().min(1),
      newName: z.string(),
    }),
    summarize: (i) => `lsp rename -> ${i.newName}`,
    handler: (i) => gw.lsp.rename(i.path, i.line, i.character, i.newName),
  });

  void path;
}
