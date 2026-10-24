import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export class SigcomLincsDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && record(value.structuredContent) && "data" in value.structuredContent ? value.structuredContent.data : value;
    if (!record(data) || !record(data._sigcom_lincs)) return data;
    if (Array.isArray(data.native)) return { metadata_records: data.native };
    return data.native;
  }
}
