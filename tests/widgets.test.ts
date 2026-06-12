import { describe, it, expect } from "vitest";
import { WIDGETS, widgetMetaForTool, imageWidgetMeta } from "@localant/mcp";

/** Extract the body of every <script> block from a widget document. */
function scriptBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

describe("widget documents", () => {
  it("registers at least the approval, coding-agent and git widgets", () => {
    const ids = WIDGETS.map((w) => w.id);
    expect(ids).toContain("approval-center");
    expect(ids).toContain("coding-agent-panel");
    expect(ids).toContain("git-panel");
    expect(ids).toContain("image-viewer");
  });

  it("every widget's embedded scripts are syntactically valid JavaScript", () => {
    for (const w of WIDGETS) {
      const html = w.html();
      const blocks = scriptBlocks(html);
      expect(blocks.length).toBeGreaterThan(0);
      for (const body of blocks) {
        // new Function compiles (parses) the body without executing it, so a
        // mismatched quote or paren in the embedded widget JS throws here.
        expect(() => new Function(body)).not.toThrow();
      }
    }
  });

  it("leaves no unresolved template interpolation in the HTML", () => {
    for (const w of WIDGETS) {
      expect(w.html()).not.toContain("${");
    }
  });

  it("each widget document carries the shared runtime and its config", () => {
    for (const w of WIDGETS) {
      const html = w.html();
      expect(html).toContain("window.LocalAntRender");
      expect(html).toContain("window.LocalAntConfig");
      expect(html).toContain('id="root"');
    }
  });
});

describe("widgetMetaForTool", () => {
  it("does NOT statically bind image tools to a template (image is per-result)", () => {
    // fs_read_file reads text most of the time; a static image template would
    // render an empty "No image payload" panel on every text read.
    for (const tool of ["fs_read_file", "fs_read_image", "computer_screenshot"]) {
      expect(widgetMetaForTool(tool)).toBeUndefined();
    }
  });

  it("imageWidgetMeta points at the image viewer template for results with an image", () => {
    const meta = imageWidgetMeta();
    expect(meta["openai/outputTemplate"]).toBe("ui://localant/image-viewer-v1.html");
    expect((meta.ui as { resourceUri: string }).resourceUri).toBe("ui://localant/image-viewer-v1.html");
  });

  it("points the approval list/get tools at the approval center template", () => {
    for (const tool of ["approval_list_pending", "approval_get"]) {
      expect(widgetMetaForTool(tool)!["openai/outputTemplate"]).toBe("ui://localant/approval-center-v1.html");
    }
  });

  it("does NOT bind action tools to a panel (they return {ok:true}, not a view)", () => {
    for (const tool of [
      "approval_approve", "approval_deny",
      "git_commit", "git_add",
      "skill_validate", "skill_enable", "skill_disable",
    ]) {
      expect(widgetMetaForTool(tool)).toBeUndefined();
    }
  });

  it("maps each top-priority panel tool to its widget", () => {
    expect(widgetMetaForTool("coding_agent_get_task")!["openai/outputTemplate"]).toBe("ui://localant/coding-agent-panel-v1.html");
    expect(widgetMetaForTool("git_status")!["openai/outputTemplate"]).toBe("ui://localant/git-panel-v1.html");
    expect(widgetMetaForTool("shell_list_processes")!["openai/outputTemplate"]).toBe("ui://localant/shell-panel-v1.html");
    expect(widgetMetaForTool("skill_list")!["openai/outputTemplate"]).toBe("ui://localant/skill-panel-v1.html");
  });

  it("returns undefined for tools without a widget", () => {
    expect(widgetMetaForTool("audit_list_logs")).toBeUndefined();
    expect(widgetMetaForTool("does_not_exist")).toBeUndefined();
  });

  it("never claims the same tool for two widgets", () => {
    const claimed = new Map<string, string>();
    for (const w of WIDGETS) {
      for (const tool of w.tools) {
        expect(claimed.has(tool)).toBe(false);
        claimed.set(tool, w.id);
      }
    }
  });
});
