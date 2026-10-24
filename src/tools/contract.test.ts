import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";
import { sigcom_lincsCatalog } from "../spec/catalog";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("registers exactly four tools with both aliases and verifiable success/error envelopes", async () => {
  const f = fixture(); const fetcher = vi.fn(async () => Response.json([])); vi.stubGlobal("fetch", fetcher);
  try {
    expect(Object.keys(f.tools)).toHaveLength(8);
    for (const prefix of ["", "mcp_"]) for (const [tool, args, error] of [
      ["search", { query: "SigCom LINCS signatures", max_results: 3 }, false],
      ["execute", { code: "return await api.post('/metadata/signatures/find',{filter:{where:{meta:{fullTextSearch:'imatinib'}},limit:1}});" }, false],
      ["execute", { code: "return await api.post('/metadata/signatures/delete',{});" }, true],
      ["get_schema", { data_access_id: "missing" }, false],
      ["query_data", { data_access_id: "missing", sql: "SELECT * FROM absent" }, true],
    ] as const) {
      const result = await f.tools[`${prefix}sigcom_lincs_${tool}`].handler(args, {});
      expect(result.isError === true).toBe(error); expect(result.content.length).toBeGreaterThan(0);
      expect(result.structuredContent).toBeDefined();
      const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args });
      expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
    }
    expect(sigcom_lincsCatalog.endpointCount).toBe(6);
  } finally { f.close(); }
});

it.each(["", "mcp_"])("stages complete signatures and preserves score signs through %s SQL recovery", async prefix => {
  const f = fixture();
  const native = { results: [{ uuid: "0389b88e-6a16-5406-ada8-8cf977784d94", "z-up": 1.25, "z-down": -2.5, "direction-down": -1, "p-down": null, note: "β".repeat(20000) }], unknownEntities: [], signatures: [] };
  const fetcher = vi.fn(async () => Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const code = "return await api.post('/data/enrich/ranktwosided',{database:'LINCS L1000 chemical perturbations',up_entities:['11111111-1111-4111-8111-111111111111'],down_entities:['22222222-2222-4222-8222-222222222222'],signatures:[],limit:1});";
  try {
    const result = await f.tools[prefix + "sigcom_lincs_execute"].handler({ code }, {});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const sc = result.structuredContent;
    const stored = await recover(f, sc.data.data_access_id, prefix);
    expect(stored.native).toEqual(native);
    expect(stored._sigcom_lincs.request_body.signatures).toEqual([]);
    expect(sc._meta.completeness).toMatchObject({ complete: false, returned: 1 });
    const proof = await verifyCitationEnvelope({ citation: sc._meta.citation, structuredContent: sc, toolArguments: { code }, materialized: { value: stored } });
    expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { f.close(); }
});
