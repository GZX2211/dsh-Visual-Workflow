import type { Context } from "@deepseek-ai/cordis";
import type { MigratedToolExecutor, MigratedToolInvocationResult } from "./types.js";
/** DSH is the only public registry. The private Python worker is an implementation detail. */
export declare class MigratedToolRegistry implements MigratedToolExecutor {
    private readonly dataDirectory;
    private readonly tools;
    private credentials;
    private disposers;
    constructor(dataDirectory: string);
    load(): Promise<void>;
    register(ctx: Context): void;
    reload(ctx: Context): Promise<void>;
    disposeRegistrations(): void;
    has(toolRef: string, requestedPackage?: string): boolean;
    list(): Array<{
        ref: string;
        label: string;
        packageId: string;
        version: string;
        origin: "dify";
    }>;
    invoke(toolRef: string, argumentsValue: Record<string, unknown>, signal?: AbortSignal, requestedPackage?: string): Promise<MigratedToolInvocationResult>;
    private activeTools;
    private select;
}
