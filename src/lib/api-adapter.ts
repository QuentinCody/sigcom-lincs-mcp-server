import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { decodeResponseText, readResponseBytes } from "@bio-mcp/shared/http/response-reader";
import { emptyBody, enrichmentBody, metadataBody } from "./validation";

const METADATA = "https://maayanlab.cloud/sigcom-lincs/metadata-api";
const DATA = "https://data-api.sigcom-lincs.k8s.maayanlab.cloud/v1/api/v1";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function route(request: Parameters<ApiFetchFn>[0]) {
  if (request.method !== "POST" || Object.keys(request.params ?? {}).length) throw Object.assign(new Error("SigCom queries require POST JSON bodies without query parameters"), { status: 405 });
  const metadata = /^\/metadata\/(signatures|libraries|entities|resources)\/find$/.exec(request.path);
  if (metadata) {
    const body = metadataBody(request.body);
    return { url: `${METADATA}/${metadata[1]}/find`, body, kind: "metadata", limit: body.filter.limit };
  }
  if (request.path === "/data/listdata") return { url: `${DATA}/listdata`, body: emptyBody(request.body), kind: "repositories", limit: null };
  if (request.path === "/data/enrich/ranktwosided") {
    const body = enrichmentBody(request.body);
    return { url: `${DATA}/enrich/ranktwosided`, body, kind: "enrichment", limit: body.limit };
  }
  throw Object.assign(new Error("Unsupported SigCom path; use the catalog's read/search POST routes"), { status: 400 });
}

async function read(url: string, body: unknown, metadataPage: boolean) {
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) throw Object.assign(new Error("SigCom request exceeds 64 KiB"), { status: 413 });
  const controller = new AbortController(); const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = fetch(url, { method: "POST", body: serialized, redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "bio-mcp-sigcom-lincs" } });
    void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("SigCom request exceeded 20 seconds"), { status: 504 })); }, 20000);
    })]);
    const text = decodeResponseText(await readResponseBytes(response, { label: "SigCom LINCS", maxBytes: 2 * 1024 * 1024, timeoutMs: 20000 - (Date.now() - started) }), "SigCom LINCS");
    if (!response.ok) throw Object.assign(new Error(`SigCom HTTP ${response.status}`), { status: response.status, data: { native_error: text, retry_after: response.headers.get("retry-after") } });
    if (response.status !== 200 || (response.headers.has("content-range") && !metadataPage) || !response.headers.get("content-type")?.includes("json")) throw Object.assign(new Error("SigCom returned a partial or non-JSON representation"), { status: 502, data: text });
    try { return { native: JSON.parse(text.replace(/^\uFEFF/, "")) as unknown, response }; }
    catch { throw Object.assign(new Error("SigCom returned malformed JSON"), { status: 502, data: text }); }
  } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}

export function createSigcomLincsApiFetch(): ApiFetchFn {
  return async request => {
    const { url, body, kind, limit: requested } = route(request);
    try {
      const { native, response } = await read(url, body, kind === "metadata");
      const valid = kind === "metadata" ? Array.isArray(native) && native.every(record)
        : record(native) && (kind === "repositories" ? Array.isArray(native.repositories) : Array.isArray(native.results) || record(native.results));
      if (!valid) throw Object.assign(new Error("SigCom response did not match the selected collection; native error evidence retained"), { status: 502, data: native });
      const rows = Array.isArray(native) ? native : record(native) && Array.isArray(native.results) ? native.results : record(native) && Array.isArray(native.repositories) ? native.repositories : null;
      if (requested !== null && rows && rows.length > requested) throw Object.assign(new Error("SigCom exceeded the requested result limit; no rows silently dropped"), { status: 502, data: native });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(native)));
      return { status: response.status, data: { native, _sigcom_lincs: {
        source_url: url, retrieved_at: new Date().toISOString(), response_sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
        hash_scope: "JSON.stringify of the complete parsed upstream response", kind, request_body: body,
        content_range: response.headers.get("content-range"),
        returned_records: rows?.length ?? null, automatic_paging: false, linked_files_downloaded: false,
        release_pinned: false, complete_dataset: false,
        interpretation: "A full-text match is textual relevance, not verified drug perturbation identity. Verify library and explicit perturbation metadata before benchmark use. Retain dose, time, cell line, assay, native score signs and dataset terms. A signature association or reversal is not binding evidence, a toxicity label or proof of treatment benefit.",
      } }, completeness: { complete: false, ...(rows ? { returned: rows.length } : {}), truncation: { reason: "unknown", detail: "One bounded SigCom response; live collection order and release are not pinned.", remedy: "Inspect native results and query metadata. Preserve gene-to-UUID mapping and unmatched genes. No automatic paging or external downloads." } }, upstreamTotal: null };
    } catch (error) {
      if (error instanceof Error) {
        const detail = error as Error & { data?: unknown };
        detail.data = { source_url: url, native_error: detail.data };
      }
      throw error;
    }
  };
}
