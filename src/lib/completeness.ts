import type { Completeness } from "@bio-mcp/shared";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function sigcom_lincsCompleteness(value: unknown): Completeness | undefined {
  const pending = [value]; const observations: Completeness[] = [];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
    } else if (record(item) && record(item._sigcom_lincs)) {
      const count = item._sigcom_lincs.returned_records;
      observations.push({ complete: false, ...(typeof count === "number" ? { returned: count } : {}),
        truncation: { reason: "unknown", detail: "One SigCom response with no release pinning or automatic paging.", remedy: "Keep native query, dataset, dose, time, cell context and original score signs. Missing genes and ambiguous entity mappings require explicit review." } });
    } else pending.push(...Object.values(item));
  }
  if (observations.length < 2) return observations[0];
  return { complete: false, truncation: { reason: "unknown", detail: "Composed SigCom responses have independently scoped coverage.", remedy: "Keep source query contexts separate; do not sum unrelated metadata and enrichment counts." } };
}
