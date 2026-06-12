import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WidgetDef } from "./runtime.js";
import { imageViewer } from "./image-viewer.js";
import { approvalCenter } from "./approval-center.js";
import { codingAgentPanel } from "./coding-agent-panel.js";
import { gitPanel } from "./git-panel.js";
import { shellPanel } from "./shell-panel.js";
import { browserPanel } from "./browser-panel.js";
import { adbPanel } from "./adb-panel.js";
import { mcpPanel } from "./mcp-panel.js";
import { skillPanel } from "./skill-panel.js";

export type { WidgetDef } from "./runtime.js";
export { IMAGE_META_KEY, IMAGE_TOOL_NAMES } from "./image-viewer.js";

const APPS_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** Every widget LocalAnt exposes as an Apps SDK component. */
export const WIDGETS: readonly WidgetDef[] = [
  imageViewer,
  approvalCenter,
  codingAgentPanel,
  gitPanel,
  shellPanel,
  browserPanel,
  adbPanel,
  mcpPanel,
  skillPanel,
];

/** tool name -> the widget that renders its result. Built once, validated. */
const TOOL_TO_WIDGET: Map<string, WidgetDef> = (() => {
  const map = new Map<string, WidgetDef>();
  for (const w of WIDGETS) {
    for (const tool of w.tools) {
      const existing = map.get(tool);
      if (existing) {
        throw new Error(`Tool "${tool}" is claimed by both ${existing.id} and ${w.id} widgets.`);
      }
      map.set(tool, w);
    }
  }
  return map;
})();

/**
 * Descriptor `_meta` for a tool that renders through a widget: the Apps SDK
 * `openai/outputTemplate` plus the `ui.resourceUri` compatibility hint and the
 * invoking/invoked status labels. Returns undefined for plain tools.
 */
export function widgetMetaForTool(name: string): Record<string, unknown> | undefined {
  const widget = TOOL_TO_WIDGET.get(name);
  if (!widget) return undefined;
  return {
    ui: { resourceUri: widget.uri },
    "openai/outputTemplate": widget.uri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
  };
}

/** Register every widget as an MCP resource on the given server. */
export function registerWidgets(server: McpServer): void {
  for (const widget of WIDGETS) {
    const csp = widget.csp ?? { connectDomains: [], resourceDomains: [] };
    server.registerResource(
      `localant-${widget.id}`,
      widget.uri,
      {},
      async () => ({
        contents: [
          {
            uri: widget.uri,
            mimeType: APPS_RESOURCE_MIME_TYPE,
            text: widget.html(),
            _meta: {
              ui: { prefersBorder: true, csp: { connectDomains: csp.connectDomains, resourceDomains: csp.resourceDomains } },
              "openai/widgetDescription": widget.description,
              "openai/widgetPrefersBorder": true,
              "openai/widgetCSP": { connect_domains: csp.connectDomains, resource_domains: csp.resourceDomains },
            },
          },
        ],
      }),
    );
  }
}
