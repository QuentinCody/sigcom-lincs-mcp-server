import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { sigcom_lincsCatalog } from "../spec/catalog";
import { createSigcomLincsApiFetch } from "../lib/api-adapter";
import { sigcom_lincsResponse } from "../lib/tool-result";

interface CodeModeEnv {
    SIGCOM_LINCS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createSigcomLincsApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof sigcom_lincsResponse>;
        const respond = (input: unknown, extra: unknown) => sigcom_lincsResponse(() => handler(input, extra), env, String(name), extra, input);
        // SAFETY: shared factories supply SDK arguments; only the alias and response boundary change.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "sigcom_lincs",
        catalog: sigcom_lincsCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "sigcom_lincs",
        // Verifiable provenance: sigcom_lincs_execute results carry a _meta.citation.
        source: { id: "sigcom_lincs", name: "SigCom LINCS", url: "https://maayanlab.cloud/sigcom-lincs/" },
        catalog: sigcom_lincsCatalog,
        apiFetch,
        preserveApiErrors: true,
        doNamespace: env.SIGCOM_LINCS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60000,
    });
    executeTool.register(registrar);
}
