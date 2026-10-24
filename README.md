# SigCom LINCS MCP server

Public perturbation metadata and two-sided rank enrichment, using the existing
Code Mode and SQLite staging patterns. Tool prefix: `sigcom_lincs`; server alias:
`sigcom-lincs`; local port: `8910`. No credential or GPU is required.

Tools are `sigcom_lincs_search`, `sigcom_lincs_execute`,
`sigcom_lincs_query_data`, `sigcom_lincs_get_schema`, and their `mcp_` aliases.
Resources at `resource://sigcom-lincs/` expose `catalog`, `query-notes` and
`pagination-rate-limits`.

| Virtual POST path | Upstream |
| --- | --- |
| `/metadata/{signatures,libraries,entities,resources}/find` | `https://maayanlab.cloud/sigcom-lincs/metadata-api/.../find` |
| `/data/listdata` | `https://data-api.sigcom-lincs.k8s.maayanlab.cloud/v1/api/v1/listdata` |
| `/data/enrich/ranktwosided` | Same data base, `/enrich/ranktwosided` |

```javascript
return await api.post('/metadata/signatures/find', {
  filter: {where: {meta: {fullTextSearch: 'imatinib'}}, limit: 1}
});
```

Metadata supports a bounded subset of LoopBack: exact values, `eq`, `inq`, and
`meta.fullTextSearch`. See the catalog for supported fields. `inq` is limited to
100 values. Search/enrichment limits are 1–100 (default 20), with `skip`/`offset`
0–10000. Unknown operators, ordering, includes, mutation routes, query parameters
and arbitrary upstream URLs fail before network access. Each call makes one POST,
with no retry, redirect following, automatic pagination or linked-file downloads.
Requests are capped at 64 KiB, responses at 2 MiB, and total header/body time at
20 seconds. Back off if the provider returns HTTP 429.

For enrichment, first resolve symbols using `/metadata/entities/find`, for example
`{filter:{where:{meta:{symbol:{inq:['STAT3','EGFR']}}},limit:100}}`. Retain all
returned mappings, ambiguous symbols and missing genes. Use **entity UUIDs**, not
gene symbols, in `up_entities` and `down_entities`; each list must contain 1–500
distinct UUIDs and the lists must be disjoint. Obtain `database` from
`/data/listdata` and preserve its exact value, including spaces. `signatures` is
required: an empty array searches the entire selected library; otherwise provide
at most 100 signature UUIDs. Requests exceeding the body cap fail explicitly.

Every parsed native field is preserved under `native`, including metadata links,
score signs, directions, nulls and unmatched entities. `_sigcom_lincs` retains
source URL, query body, time, native `Content-Range` and parsed-response SHA-256.
HTTP 200 metadata pages legitimately carry `Content-Range` (observed `0-1/863`
with one complete row); the header is preserved without interpreting it as
transport truncation or deriving a guaranteed inventory count. HTTP 206 remains
an error. Results above 30 KiB stage
with both MCP response fields and citation metadata; SQL/schema tools recover the
original envelope. Provider and adapter errors retain source context and are
explicit errors, never empty successful result sets. No release pinning or complete
inventory is claimed from a page.

Keep cell line, dose, time, assay and library with each signature. Preserve native
`z-down`, `z-up`, direction and significance fields without sign reversal. A
transcriptional association or reversal is not evidence of kinase binding,
clinical toxicity, causation or treatment benefit. These sources must not supply
held-out affinity labels to the protected benchmark predictor.

A full-text result is only a textual match. A query for `imatinib` can return a
GEO signature describing resistance rather than a direct imatinib perturbation.
Before using a record in the benchmark, verify its library and explicit
perturbation identity, dose, time, cell line and assay. Missing fields remain
unknown; the adapter does not infer them from the search term.

Provider qualification on October 23, 2026: bounded metadata queries returned
HTTP 200, including a valid page with `Content-Range`. Full-text imatinib searches
also returned a GEO resistance-description match; this is not a confirmed drug
perturbation record. The current data API `/listdata` returned HTTP 200. The older data URL redirected with HTTP 307,
so the adapter uses the verified current host directly. These are upstream
observations, not deployed-Worker acceptance or a live enrichment result.

References: [provider tutorial](https://maayanlab.cloud/sigcom-lincs/static/tutorial/ldp3/LDP3Tutorial.html)
and [current data API Swagger](https://data-api.sigcom-lincs.k8s.maayanlab.cloud/v1/swagger.html).
The API specification lists Apache 2.0 for its software; this is **not** blanket
permission for every underlying dataset. Preserve library/resource terms and
check the relevant dataset before redistribution. Drift risk is medium; review
the catalog, schema and small metadata/listdata examples monthly.

Validation: focused adapter and tool-contract tests cover request limits, UUID
semantics, injection rejection, routing, deadlines, native evidence, both aliases,
citations and large-result recovery. Run them serially within the available
machine's resource budget, then run `scripts/verify-server.mjs sigcom-lincs`
against the local Worker before deployment. No dependencies were installed and
no deployment or cloud compute was launched by this implementation.
