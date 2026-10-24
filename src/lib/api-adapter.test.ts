import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createSigcomLincsApiFetch } from "./api-adapter";

const api = createSigcomLincsApiFetch();
const up = "11111111-1111-4111-8111-111111111111";
const down = "22222222-2222-4222-8222-222222222222";
const signature = "0389b88e-6a16-5406-ada8-8cf977784d94";
const path = "/metadata/signatures/find";
const body = { filter: { where: { meta: { fullTextSearch: "imatinib" } }, limit: 1 } };
const enrichment = { database: "LINCS L1000 chemical perturbations", up_entities: [up], down_entities: [down], signatures: [], limit: 1 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains native perturbation context, links and provenance without fetching linked files", async () => {
  const native = [{ id: signature, library: "54198d6e-fe17-5ef8-91ac-02b425761653", meta: { pert_name: "imatinib", cell_line: "A549", pert_dose: "10 uM", pert_time: "24 h", persistent_id: "https://files.invalid/signature.tsv", future: null } }];
  const fetcher = vi.fn().mockImplementation(async () => Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await api({ method: "POST", path, body });
  expect(result).toMatchObject({ status: 200, data: { native, _sigcom_lincs: {
    source_url: "https://maayanlab.cloud/sigcom-lincs/metadata-api/signatures/find", returned_records: 1, linked_files_downloaded: false,
    request_body: { filter: { ...body.filter, skip: 0 } },
    response_sha256: createHash("sha256").update(JSON.stringify(native)).digest("hex"),
  } }, completeness: { complete: false, returned: 1 }, upstreamTotal: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "manual", signal: expect.any(AbortSignal) });
});

it.each(["libraries", "entities", "resources"])("routes documented %s metadata reads and preserves empty pages", async collection => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json([])); vi.stubGlobal("fetch", fetcher);
  const filter = collection === "entities" ? { where: { meta: { symbol: { inq: ["STAT3", "EGFR"] } } }, limit: 100, skip: 20 } : { where: { id: { inq: [up] } } };
  const result = await api({ method: "POST", path: `/metadata/${collection}/find`, body: { filter } });
  expect(result).toMatchObject({ data: { native: [], _sigcom_lincs: { complete_dataset: false } }, completeness: { complete: false, returned: 0 } });
  expect(fetcher.mock.calls[0][0]).toBe(`https://maayanlab.cloud/sigcom-lincs/metadata-api/${collection}/find`);
});

it("accepts a complete HTTP 200 metadata page with native Content-Range without claiming drug identity", async () => {
  const native = [{ id: signature, meta: { signatureDescription: "Gene expression in imatinib-resistant cells" } }];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(native, { headers: { "content-range": "0-1/863" } })));
  const result = await api({ method: "POST", path, body });
  expect(result).toMatchObject({ status: 200, data: { native, _sigcom_lincs: { content_range: "0-1/863", returned_records: 1 } }, completeness: { complete: false, returned: 1 }, upstreamTotal: null });
  expect(JSON.stringify(result)).toContain("not verified drug perturbation identity");
});

it("rejects HTTP 206 even if the partial body is valid metadata JSON", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([{ id: signature }], { status: 206, headers: { "content-range": "0-1/863" } })));
  await expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status: 502, data: { source_url: expect.stringContaining("metadata-api") } });
});

it("queries the verified data API base and preserves negative z-down and direction fields", async () => {
  const native = { results: [{ uuid: signature, "z-up": 1.5, "z-down": -2.5, "z-sum": -1, "direction-up": 1, "direction-down": -1, "p-down": null }], signatures: [signature], unknownEntities: [] };
  const fetcher = vi.fn().mockImplementation(async () => Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const result = await api({ method: "POST", path: "/data/enrich/ranktwosided", body: enrichment });
  expect(result).toMatchObject({ data: { native, _sigcom_lincs: { request_body: { ...enrichment, offset: 0 } } } });
  expect(fetcher.mock.calls[0][0]).toBe("https://data-api.sigcom-lincs.k8s.maayanlab.cloud/v1/api/v1/enrich/ranktwosided");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ ...enrichment, offset: 0 });
});

it("preserves listdata names containing spaces instead of assuming database identifiers are UUIDs", async () => {
  const native = { repositories: [{ uuid: enrichment.database, datatype: "rank_matrix" }] };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(native)));
  expect(await api({ method: "POST", path: "/data/listdata", body: {} })).toMatchObject({ data: { native } });
});

it.each([
  { method: "GET", path, body }, { method: "DELETE", path, body },
  { method: "POST", path: "/metadata/signatures/delete", body },
  { method: "POST", path: "/metadata/signatures/find?x=1", body },
  { method: "POST", path: "/metadata/../signatures/find", body },
  { method: "POST", path, body, params: { baseUrl: "https://elsewhere.invalid" } },
  { method: "POST", path, body: { filter: { limit: 101 } } },
  { method: "POST", path, body: { filter: { limit: "1" } } },
  { method: "POST", path, body: { filter: { skip: 10001 } } },
  { method: "POST", path, body: { filter: { include: "all" } } },
  { method: "POST", path, body: { filter: { where: { "$where": "return true" } } } },
  { method: "POST", path, body: { filter: { where: { meta: { symbol: { regexp: ".*" } } } } } },
  { method: "POST", path, body: { filter: { where: { id: "not-a-UUID" } } } },
  { method: "POST", path, body: { filter: { where: { meta: { symbol: { inq: Array(101).fill("EGFR") } } } } } },
  { method: "POST", path, body: { filter: null } },
  { method: "POST", path: "/data/listdata", body: { limit: 1 } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, up_entities: ["STAT3"] } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, signatures: undefined } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, down_entities: [up] } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, up_entities: [up, up] } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, up_entities: Array(501).fill(up) } },
  { method: "POST", path: "/data/enrich/ranktwosided", body: { ...enrichment, limit: 101 } },
])("rejects unsupported or unbounded requests before network: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});

it("enforces the serialized request cap even for individually valid metadata conditions", async () => {
  const inq = Array(100).fill("x".repeat(250));
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "POST", path, body: { filter: { where: { meta: { symbol: { inq }, pert_name: { inq }, cell_line: { inq } } } } } })).rejects.toMatchObject({ status: 413 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([307, 429, 503])("retains HTTP %s provider failure without retry or redirect", async status => {
  const fetcher = vi.fn().mockImplementation(async () => new Response("provider evidence", { status, headers: { location: "https://elsewhere.invalid", "retry-after": "60" } })); vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status, data: { source_url: expect.stringContaining("metadata-api"), native_error: { native_error: "provider evidence", retry_after: "60" } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects malformed data, application errors and upstream pagination violations without dropping rows", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const native of [{ error: "unavailable" }, [null], [{}, {}]]) {
    fetcher.mockResolvedValueOnce(Response.json(native));
    await expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status: 502, data: { native_error: native } });
  }
  fetcher.mockResolvedValueOnce(new Response("{broken", { headers: { "content-type": "application/json" } }));
  await expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status: 502, data: { native_error: "{broken" } });
});

it("enforces the 2 MiB response cap and aborts stalled bodies within the shared 20-second budget", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } })));
  await expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status: 413 });
  vi.useFakeTimers(); const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } })));
  const pending = expect(api({ method: "POST", path, body })).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(20000); await pending; expect(cancel).toHaveBeenCalled();
});
