/**
 * lib/prompt-builder/index.ts
 */

import type { SystemPromptData } from "../config/system-prompt";
import type { ExecutionContext } from "../mcp-bridge/executor";
import { buildGetmobilWebsiteContext } from "./getmobil-website";

export interface TaskBuildInput {
  ctx: ExecutionContext;
  resolvedPrompt: string;
  rootUrl: string;
  sysData: SystemPromptData;
  domainContext?: string;
}

export function buildPageAgentTask(input: TaskBuildInput): string {
  const { ctx, resolvedPrompt, rootUrl, domainContext } = input;
  const { testCase } = ctx;

  const platformContext =
    ctx.platform === "website" ? buildGetmobilWebsiteContext() + "\n\n" : "";

  const domainSection = domainContext
    ? `<domain_context>\n${domainContext}\n</domain_context>\n\n`
    : "";

  const SPA_HINT = `
NAVIGATION STRATEGY (important):
- This is a Single Page Application (SPA). After every click, do NOT wait
  for a full page reload — the URL may not change.
- After clicking a button, wait max 2 seconds then check if the expected
  element appeared in the DOM. If it did, proceed immediately.
- For checkout steps (cart, payment, confirmation): click the button once,
  wait 1 second, then look for the next step's UI elements.
- Never click the same button twice if the page is still loading.
- If a button appears disabled or shows a loading spinner, wait 1 second
  and check again — do not retry more than 3 times.
- Preferred action sequence for each step:
    1. screenshot (observe current state)
    2. click target element
    3. wait 1000ms
    4. screenshot (verify state changed)
    5. proceed to next goal`.trim();

  const coreTask = `${platformContext}${domainSection}You are a QA automation agent. The browser is already open on ${rootUrl}.

Actions you can use: done, wait, click_element_by_index, input_text, select_dropdown_option, scroll, scroll_horizontally, open_new_tab, switch_to_tab, close_tab.

TASK
${resolvedPrompt}

EXPECTED
${testCase.expectedOutcome}

RULES
- Scroll elements into view before clicking.
- After each action, verify the expected state change occurred.
- After opening a dropdown, modal, or any dynamic UI element, use wait before interacting with its contents — these elements need time to render.
- If an element is not found after 2 attempts: done(false, "element not found: <name>").
- If an action causes no state change: done(false, "silent failure: <description>").
- done(true, ...) only when all steps are confirmed successful.`;

  return coreTask + "\n\n" + SPA_HINT;
}

export function sanitizePrompt(raw: string): string {
  return raw.trim();
}

