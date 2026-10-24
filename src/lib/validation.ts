const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!record(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unsupported ${label} field: ${key}`);
}
function integer(value: unknown, fallback: number, max: number, label: string, min = 0) {
  const parsed = value === undefined ? fallback : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail(`${label} must be an integer from ${min} to ${max}`);
  return parsed as number;
}
function scalar(value: unknown, uuid = false) {
  if (uuid) { if (typeof value !== "string" || !UUID.test(value)) fail("Entity, signature, library and resource IDs must be UUIDs"); }
  else if (!(typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)) && !(typeof value === "number" && Number.isFinite(value)) && typeof value !== "boolean") fail("Filter values must be short strings, finite numbers or booleans");
  return value;
}
function condition(value: unknown, uuid = false): unknown {
  if (!record(value)) return scalar(value, uuid);
  keys(value, ["eq", "inq"], "filter operator");
  if (Object.keys(value).length !== 1) fail("Use one eq or inq operator");
  if ("eq" in value) return { eq: scalar(value.eq, uuid) };
  if (!Array.isArray(value.inq) || value.inq.length < 1 || value.inq.length > 100) fail("inq requires 1–100 values");
  return { inq: (value.inq as unknown[]).map(item => scalar(item, uuid)) };
}
function where(value: unknown) {
  const input = object(value, "where");
  keys(input, ["id", "library", "resource", "dataset", "dataset_type", "meta"], "where");
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (key !== "meta") { result[key] = condition(item, ["id", "library", "resource"].includes(key)); continue; }
    const meta = object(item, "meta");
    keys(meta, ["fullTextSearch", "symbol", "pert_name", "cell_line", "pert_dose", "pert_time", "pubchem_id", "assay", "tissue", "libraryName", "libraryID"], "meta filter");
    result.meta = Object.fromEntries(Object.entries(meta).map(([name, field]) => {
      if (name === "fullTextSearch") {
        if (typeof field !== "string" || field.length < 1 || field.length > 200 || /[\x00-\x1f]/.test(field)) fail("fullTextSearch requires 1–200 printable characters");
        return [name, field];
      }
      return [name, condition(field)];
    }));
  }
  return result;
}
function uuidList(value: unknown, name: string, max: number, min = 0): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${name} requires ${min}–${max} UUIDs`);
  const values = (value as unknown[]).map(item => scalar(item, true) as string);
  if (new Set(values.map(item => item.toLowerCase())).size !== values.length) fail(`${name} contains duplicate UUIDs`);
  return values;
}

/** A deliberately bounded subset of the documented LoopBack query language. */
export function metadataBody(value: unknown) {
  const input = object(value, "body"); keys(input, ["filter"], "body");
  const filter = object(input.filter === undefined ? {} : input.filter, "filter"); keys(filter, ["where", "limit", "skip"], "filter");
  return { filter: { ...(filter.where === undefined ? {} : { where: where(filter.where) }),
    limit: integer(filter.limit, 20, 100, "limit", 1), skip: integer(filter.skip, 0, 10000, "skip") } };
}

export function enrichmentBody(value: unknown) {
  const input = object(value, "body");
  keys(input, ["database", "up_entities", "down_entities", "signatures", "limit", "offset"], "enrichment");
  if (typeof input.database !== "string" || input.database.trim().length < 1 || input.database.length > 200 || /[\x00-\x1f]/.test(input.database)) fail("database requires an exact repository name returned by /data/listdata");
  const up = uuidList(input.up_entities, "up_entities", 500, 1);
  const down = uuidList(input.down_entities, "down_entities", 500, 1);
  const upSet = new Set(up.map(item => item.toLowerCase()));
  if (down.some(item => upSet.has(item.toLowerCase()))) fail("Up and down entity sets must not overlap");
  return { database: input.database, up_entities: up, down_entities: down,
    signatures: uuidList(input.signatures, "signatures", 100),
    limit: integer(input.limit, 20, 100, "limit", 1), offset: integer(input.offset, 0, 10000, "offset") };
}

export function emptyBody(value: unknown) {
  const input = object(value, "body"); keys(input, [], "listdata"); return {};
}
