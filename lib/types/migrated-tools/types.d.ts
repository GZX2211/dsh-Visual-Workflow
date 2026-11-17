export interface MigratedToolCredentialSpec {
    name: string;
    label: string;
    required: boolean;
    secret: boolean;
}
export interface MigratedToolSpec {
    ref: string;
    name: string;
    label: string;
    description: string;
    provider: string;
    implementationPath: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
}
export interface MigratedToolPackageManifest {
    schemaVersion: 1;
    id: string;
    name: string;
    version: string;
    description: string;
    origin: {
        platform: "dify";
        targetVersion: string;
        packageId: string;
        sha256: string;
        author: string;
        plugin: string;
    };
    runtime: {
        kind: "python-dify-tool-worker";
        command: string;
        workerPath: string;
        payloadPath: string;
        timeoutMs: number;
    };
    credentials: MigratedToolCredentialSpec[];
    tools: MigratedToolSpec[];
}
export interface MigratedToolInvocationResult {
    text: string;
    messages: Array<{
        type: string;
        value: unknown;
        meta?: Record<string, unknown> | null;
    }>;
}
export interface MigratedToolExecutor {
    has(toolRef: string, requestedPackage?: string): boolean;
    invoke(toolRef: string, argumentsValue: Record<string, unknown>, signal?: AbortSignal, requestedPackage?: string): Promise<MigratedToolInvocationResult>;
}
