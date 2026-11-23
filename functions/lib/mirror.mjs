// 与 backend/app/internal/guard/mirror.py 对齐：流量镜像，业务 Agent 工具执行前的最小化取数。
import { iso, newId, utcnow } from "./deps.mjs";

export const CONTEXT_TRUNCATE = 400;

// 与 Python len/切片一致的按码点处理（UTF-16 下 emoji 等为 2 单元）。
function slicePy(text, end) {
  const chars = Array.from(String(text));
  return chars.length > end ? chars.slice(0, end).join("") : String(text);
}

export function buildMirrorRequest(
  sessionId,
  turn,
  userInput,
  contextSummary,
  toolName,
  toolParams,
  baselineSummary,
) {
  let summary = contextSummary || "";
  if (Array.from(summary).length > CONTEXT_TRUNCATE) {
    summary = slicePy(summary, CONTEXT_TRUNCATE) + "…（已截断）";
  }
  return {
    mirror_id: newId("mir"),
    session_id: sessionId,
    turn,
    user_input: slicePy(userInput || "", 2000),
    recent_context_summary: summary,
    tool_name: toolName,
    tool_params: toolParams || {},
    baseline_summary: baselineSummary,
    timestamp: iso(utcnow()),
  };
}
