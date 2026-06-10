import type { Gateway } from "../gateway.js";
import { registerSystemTools } from "./system.js";
import { registerAuditTools, registerApprovalTools } from "./audit-approval.js";
import { registerProjectTools } from "./project.js";
import { registerFilesystemTools } from "./filesystem.js";
import { registerGitTools } from "./git.js";
import { registerShellTools } from "./shell.js";
import { registerSkillTools } from "./skill.js";
import { registerCodingAgentTools } from "./coding-agent.js";
import { registerAdbTools } from "./adb.js";
import { registerBrowserTools } from "./browser.js";
import { registerArticleTools } from "./article.js";
import { registerAdapterTools } from "./adapters.js";

/** Register every built-in tool family onto the gateway registry. */
export function registerAllTools(gw: Gateway): void {
  registerSystemTools(gw);
  registerAuditTools(gw);
  registerApprovalTools(gw);
  registerProjectTools(gw);
  registerFilesystemTools(gw);
  registerGitTools(gw);
  registerShellTools(gw);
  registerSkillTools(gw);
  registerCodingAgentTools(gw);
  registerAdbTools(gw);
  registerBrowserTools(gw);
  registerArticleTools(gw);
  registerAdapterTools(gw);
}
