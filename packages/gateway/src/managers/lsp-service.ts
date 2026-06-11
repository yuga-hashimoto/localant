import fs from "node:fs";
import path from "node:path";
import { PathGuard } from "../security/path-guard.js";

/**
 * Minimal TypeScript code-intelligence backed by the `typescript` compiler's
 * LanguageService. `typescript` is an OPTIONAL runtime dependency (it is always
 * present in a TS project's node_modules); when it cannot be resolved the tools
 * return install guidance instead of throwing.
 *
 * A LanguageService is built lazily per project root and cached. The file set is
 * discovered from the root's tsconfig (or a directory scan fallback). All paths
 * are validated by PathGuard before they are read.
 */
interface TsLike {
  createLanguageService: (host: unknown) => TsLanguageService;
  ScriptSnapshot: { fromString: (s: string) => unknown };
  sys: { getCurrentDirectory: () => string };
  getDefaultLibFilePath: (opts: unknown) => string;
  findConfigFile: (dir: string, exists: (f: string) => boolean, name?: string) => string | undefined;
  readConfigFile: (file: string, read: (f: string) => string | undefined) => { config?: unknown };
  parseJsonConfigFileContent: (
    config: unknown,
    host: unknown,
    basePath: string,
  ) => { fileNames: string[]; options: Record<string, unknown> };
}

interface TsLanguageService {
  getProgram: () => unknown;
  getNavigationBarItems: (fileName: string) => NavItem[];
  getDefinitionAtPosition: (fileName: string, pos: number) => DefRef[] | undefined;
  getReferencesAtPosition: (fileName: string, pos: number) => DefRef[] | undefined;
  getQuickInfoAtPosition: (fileName: string, pos: number) => QuickInfo | undefined;
  findRenameLocations: (
    fileName: string,
    pos: number,
    findInStrings: boolean,
    findInComments: boolean,
  ) => RenameLoc[] | undefined;
}

interface TextSpan {
  start: number;
  length: number;
}
interface NavItem {
  text: string;
  kind: string;
  spans: TextSpan[];
  childItems?: NavItem[];
}
interface DefRef {
  fileName: string;
  textSpan: TextSpan;
}
interface QuickInfo {
  displayParts?: { text: string }[];
  documentation?: { text: string }[];
}
interface RenameLoc {
  fileName: string;
  textSpan: TextSpan;
}

let tsModule: TsLike | undefined;
let tsLoadFailed = false;

async function loadTs(): Promise<TsLike | undefined> {
  if (tsModule) return tsModule;
  if (tsLoadFailed) return undefined;
  try {
    const mod = (await import("typescript")) as unknown as { default?: TsLike } & TsLike;
    tsModule = (mod.default ?? mod) as TsLike;
    return tsModule;
  } catch {
    tsLoadFailed = true;
    return undefined;
  }
}

export const LSP_INSTALL_HINT =
  "TypeScript is not resolvable. Install it in the project (`npm i -D typescript`) to enable LSP navigation.";

export class LspService {
  private cache = new Map<string, { service: TsLanguageService; ts: TsLike }>();

  constructor(private readonly guard: PathGuard) {}

  /** Convert an absolute offset to a 1-indexed line/character. */
  static offsetToLineChar(text: string, offset: number): { line: number; character: number } {
    let line = 1;
    let last = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === "\n") {
        line++;
        last = i + 1;
      }
    }
    return { line, character: offset - last + 1 };
  }

  /** Convert a 1-indexed line/character to an absolute offset. */
  private lineCharToOffset(text: string, line: number, character: number): number {
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i]!.length + 1;
    return offset + (character - 1);
  }

  private rootFor(file: string): string {
    let dir = path.dirname(file);
    // Walk up to the nearest tsconfig.json, else use the file's directory.
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "tsconfig.json"))) return dir;
      dir = path.dirname(dir);
    }
    return path.dirname(file);
  }

  private async serviceFor(file: string): Promise<{ service: TsLanguageService; ts: TsLike } | undefined> {
    const ts = await loadTs();
    if (!ts) return undefined;
    const root = this.rootFor(file);
    const cached = this.cache.get(root);
    if (cached) return cached;

    let fileNames: string[] = [];
    let options: Record<string, unknown> = { allowJs: true };
    const configPath = ts.findConfigFile(root, (f) => fs.existsSync(f), "tsconfig.json");
    if (configPath) {
      const { config } = ts.readConfigFile(configPath, (f) => {
        try {
          return fs.readFileSync(f, "utf8");
        } catch {
          return undefined;
        }
      });
      const host = {
        fileExists: (f: string) => fs.existsSync(f),
        readFile: (f: string) => {
          try {
            return fs.readFileSync(f, "utf8");
          } catch {
            return undefined;
          }
        },
        readDirectory: () => [] as string[],
        useCaseSensitiveFileNames: true,
        getCurrentDirectory: () => root,
      };
      const parsed = ts.parseJsonConfigFileContent(config, host, root);
      fileNames = parsed.fileNames;
      options = parsed.options;
    }
    // Ensure the requested file is part of the program.
    if (!fileNames.includes(file)) fileNames.push(file);

    const versions = new Map<string, number>();
    const host = {
      getScriptFileNames: () => fileNames,
      getScriptVersion: (f: string) => String(versions.get(f) ?? 0),
      getScriptSnapshot: (f: string) => {
        try {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"));
        } catch {
          return undefined;
        }
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o: unknown) => ts.getDefaultLibFilePath(o),
      fileExists: (f: string) => fs.existsSync(f),
      readFile: (f: string) => {
        try {
          return fs.readFileSync(f, "utf8");
        } catch {
          return undefined;
        }
      },
      readDirectory: () => [] as string[],
      directoryExists: (d: string) => {
        try {
          return fs.statSync(d).isDirectory();
        } catch {
          return false;
        }
      },
      getDirectories: (d: string) => {
        try {
          return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          return [];
        }
      },
    };
    const service = ts.createLanguageService(host);
    const entry = { service, ts };
    this.cache.set(root, entry);
    return entry;
  }

  private read(file: string): string {
    const resolved = this.guard.assertAccess(file, "read");
    return fs.readFileSync(resolved, "utf8");
  }

  async documentSymbols(file: string): Promise<{ name: string; kind: string; line: number }[] | { error: string; hint: string }> {
    const resolved = this.guard.assertAccess(file, "read");
    const entry = await this.serviceFor(resolved);
    if (!entry) return { error: "typescript not available", hint: LSP_INSTALL_HINT };
    const text = fs.readFileSync(resolved, "utf8");
    const items = entry.service.getNavigationBarItems(resolved);
    const out: { name: string; kind: string; line: number }[] = [];
    const walk = (nodes: NavItem[]) => {
      for (const n of nodes) {
        const span = n.spans[0];
        const line = span ? LspService.offsetToLineChar(text, span.start).line : 0;
        if (n.text && n.text !== "<global>") out.push({ name: n.text, kind: n.kind, line });
        if (n.childItems) walk(n.childItems);
      }
    };
    walk(items);
    return out;
  }

  async definition(file: string, line: number, character: number) {
    const resolved = this.guard.assertAccess(file, "read");
    const entry = await this.serviceFor(resolved);
    if (!entry) return { error: "typescript not available", hint: LSP_INSTALL_HINT };
    const text = this.read(resolved);
    const pos = this.lineCharToOffset(text, line, character);
    const defs = entry.service.getDefinitionAtPosition(resolved, pos) ?? [];
    return {
      definitions: defs.map((d) => ({ file: d.fileName, ...this.spanToLine(d.fileName, d.textSpan) })),
    };
  }

  async references(file: string, line: number, character: number) {
    const resolved = this.guard.assertAccess(file, "read");
    const entry = await this.serviceFor(resolved);
    if (!entry) return { error: "typescript not available", hint: LSP_INSTALL_HINT };
    const text = this.read(resolved);
    const pos = this.lineCharToOffset(text, line, character);
    const refs = entry.service.getReferencesAtPosition(resolved, pos) ?? [];
    return {
      references: refs.map((r) => ({ file: r.fileName, ...this.spanToLine(r.fileName, r.textSpan) })),
    };
  }

  async hover(file: string, line: number, character: number) {
    const resolved = this.guard.assertAccess(file, "read");
    const entry = await this.serviceFor(resolved);
    if (!entry) return { error: "typescript not available", hint: LSP_INSTALL_HINT };
    const text = this.read(resolved);
    const pos = this.lineCharToOffset(text, line, character);
    const info = entry.service.getQuickInfoAtPosition(resolved, pos);
    if (!info) return { hover: null };
    return {
      hover: (info.displayParts ?? []).map((p) => p.text).join(""),
      documentation: (info.documentation ?? []).map((p) => p.text).join(""),
    };
  }

  async rename(file: string, line: number, character: number, newName: string) {
    const resolved = this.guard.assertAccess(file, "write");
    const entry = await this.serviceFor(resolved);
    if (!entry) return { error: "typescript not available", hint: LSP_INSTALL_HINT };
    const text = this.read(resolved);
    const pos = this.lineCharToOffset(text, line, character);
    const locs = entry.service.findRenameLocations(resolved, pos, false, false) ?? [];
    if (locs.length === 0) return { error: "No rename locations found at that position." };
    // Group by file, apply from the end so offsets stay valid.
    const byFile = new Map<string, RenameLoc[]>();
    for (const loc of locs) {
      this.guard.assertAccess(loc.fileName, "write");
      const list = byFile.get(loc.fileName) ?? [];
      list.push(loc);
      byFile.set(loc.fileName, list);
    }
    let changed = 0;
    for (const [fileName, list] of byFile) {
      let content = fs.readFileSync(fileName, "utf8");
      list.sort((a, b) => b.textSpan.start - a.textSpan.start);
      for (const loc of list) {
        content = content.slice(0, loc.textSpan.start) + newName + content.slice(loc.textSpan.start + loc.textSpan.length);
        changed++;
      }
      fs.writeFileSync(fileName, content);
    }
    return { renamed: newName, locations: changed, files: [...byFile.keys()] };
  }

  private spanToLine(fileName: string, span: TextSpan): { line: number; character: number } {
    try {
      const text = fs.readFileSync(fileName, "utf8");
      return LspService.offsetToLineChar(text, span.start);
    } catch {
      return { line: 0, character: 0 };
    }
  }
}
