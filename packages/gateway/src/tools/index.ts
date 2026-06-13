import type { Gateway } from "../gateway.js";
import { registerSystemTools } from "./system.js";
import { registerAuditTools, registerApprovalTools } from "./audit-approval.js";
import { registerFilesystemTools } from "./filesystem.js";
import { registerEditingTools } from "./editing.js";
import { registerGitTools } from "./git.js";
import { registerShellTools } from "./shell.js";
import { registerBashTools } from "./bash.js";
import { registerValidationTools } from "./validation.js";
import { registerQuestionTools } from "./question.js";
import { registerLspTools } from "./lsp.js";
import { registerControlTools } from "./control.js";
import { registerSkillTools } from "./skill.js";
import { registerAutopilotTools } from "./autopilot.js";
import { registerDoctorTools } from "./doctor.js";
import { registerAdbTools } from "./adb.js";
import { registerComputerTools } from "./computer.js";
import { registerBrowserTools } from "./browser.js";
import { registerAdapterTools } from "./adapters.js";
import { registerAssetTools } from "./assets.js";
import { registerAliasTools } from "./aliases.js";

/** Register every built-in tool family onto the gateway registry. */
export function registerAllTools(gw: Gateway): void {
  registerSystemTools(gw);
  registerAuditTools(gw);
  registerApprovalTools(gw);
  registerFilesystemTools(gw);
  registerEditingTools(gw);
  registerGitTools(gw);
  registerShellTools(gw);
  registerBashTools(gw);
  registerValidationTools(gw);
  registerQuestionTools(gw);
  registerLspTools(gw);
  registerControlTools(gw);
  registerSkillTools(gw);
  // Agent CLIs are no longer public tools: ChatGPT reaches them only through
  // the high-level `autopilot` tool, which selects an internal provider.
  registerAutopilotTools(gw);
  registerDoctorTools(gw);
  registerAdbTools(gw);
  registerComputerTools(gw);
  registerBrowserTools(gw);
  registerAdapterTools(gw);
  registerAssetTools(gw);
  // Aliases must run last: they wrap already-registered tools.
  registerAliasTools(gw);
}
