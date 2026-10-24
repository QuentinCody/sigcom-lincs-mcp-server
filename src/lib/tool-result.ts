import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { buildCitation, mergeCompleteness, type Completeness } from "@bio-mcp/shared";
import { sigcom_lincsCompleteness } from "./completeness";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

type Result = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
export type DataEnv = { SIGCOM_LINCS_DATA_DO?: unknown };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const source = { id: "sigcom_lincs", name: "SigCom LINCS", url: "https://maayanlab.cloud/sigcom-lincs/" };

async function cite(structured: Record<string, unknown>, toolName: string, query: unknown) {
  const meta = record(structured._meta) ? structured._meta : {};
  if (record(meta.citation)) return structured;
  const { _meta: _metadata, ...root } = structured;
  const citation = await buildCitation({ source, server: "sigcom_lincs", tool: toolName.replace(/^mcp_/, ""), query,
    queryScope: "tool_arguments", result: root, resultScope: "structured_content:root_without_meta", retrievedAt: new Date().toISOString() });
  return { ...structured, _meta: { ...meta, citation } };
}

export async function sigcom_lincsResponse(work: () => Promise<Result>, env: DataEnv, toolName: string, extra: unknown, query: unknown = {}): Promise<Result> {
  try {
    const original = await work();
    let structured = original.structuredContent ?? { success: original.isError !== true };
    const meta = record(structured._meta) ? structured._meta : {};
    const existing: Completeness | undefined = record(meta.completeness) && typeof meta.completeness.complete === "boolean"
      ? { ...meta.completeness, complete: meta.completeness.complete } : undefined;
    const completeness = mergeCompleteness(existing, toolName.endsWith("sigcom_lincs_execute") ? sigcom_lincsCompleteness(structured.data) : undefined);
    if (completeness) structured = { ...structured, _meta: { ...meta, completeness },
      ...(record(structured._staging) ? { _staging: { ...structured._staging, completeness } } : {}) };
    const apiError = structured.data && typeof structured.data === "object" && "__api_error" in structured.data && structured.data.__api_error === true;
    const failed = original.isError === true || structured.success === false || apiError || Boolean(structured.program_error) || structured.disposition === "partial";
    const result = { ...original, structuredContent: await cite(failed ? { ...structured, success: false } : structured, toolName, query), ...(failed ? { isError: true } : {}) };
    if (!shouldStage(bytes(result))) return result;
    if (!env.SIGCOM_LINCS_DATA_DO) throw new Error("Missing staging storage");
    const staged = await stageToDoAndRespond(result, env.SIGCOM_LINCS_DATA_DO as Parameters<typeof stageToDoAndRespond>[1], "sigcom_lincs", undefined,
      { toolName, serverName: "sigcom_lincs" }, "sigcom_lincs", extra as Parameters<typeof stageToDoAndRespond>[6]);
    const citation = await buildCitation({ source, server: "sigcom_lincs", tool: toolName.replace(/^mcp_/, ""),
      query, queryScope: "tool_arguments", retrievedAt: new Date().toISOString(), result, resultScope: "staged:full_result", dataAccessId: staged.dataAccessId });
    const combined = mergeCompleteness(completeness, staged._staging.completeness);
    const structuredContent = { success: !failed, staged: true, data: undefined, data_access_id: staged.dataAccessId,
      _staging: { ...staged._staging, ...(combined ? { completeness: combined } : {}) }, _meta: { citation, ...(combined ? { completeness: combined } : {}) } };
    if (bytes(structuredContent) > 100000) throw new Error("Staging metadata exceeds transport limit");
    return { content: [{ type: "text", text: "Response staged. Use sigcom_lincs_query_data; payloads retains the complete original response." }], structuredContent, ...(failed ? { isError: true } : {}) };
  } catch {
    const message = "SigCom LINCS response could not be returned.";
    const data = { success: false, error: { code: "RESPONSE_ERROR", message } };
    const citation = await buildCitation({ source, server: "sigcom_lincs", tool: toolName.replace(/^mcp_/, ""),
      query, queryScope: "tool_arguments", retrievedAt: new Date().toISOString(), result: data, resultScope: "structured_content:root_without_meta" });
    return { content: [{ type: "text", text: message }], structuredContent: { ...data, _meta: { citation } }, isError: true };
  }
}
