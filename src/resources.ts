import type { McpServer } from "@bio-mcp/shared/mcp";
import { sigcom_lincsCatalog } from "./spec/catalog";
export function registerResources(server: McpServer): void {
  const resources = {
    catalog: sigcom_lincsCatalog,
    "query-notes": { notes: sigcom_lincsCatalog.notes, examples: sigcom_lincsCatalog.workflows },
    "pagination-rate-limits": { max_limit: 100, max_skip_or_offset: 10000, request_bytes: 65536, response_bytes: 2097152, timeout_ms: 20000,
      automatic_paging: false, retries: 0, external_downloads: false, upstream_rate_limit: "Not guaranteed; stop/back off on 429", staging: "Above 30 KiB: inspect sigcom_lincs_get_schema then use sigcom_lincs_query_data. Original payload remains recoverable." },
  };
  for (const [name, data] of Object.entries(resources)) {
    const uri = `resource://sigcom-lincs/${name}`;
    server.registerResource(name, uri, { mimeType: "application/json", description: `SigCom LINCS ${name}` }, async () => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] }));
  }
}
