import type { DifyToolMigrationResult, DifyToolUpload } from "../shared/migrated-tool-migration.js";
interface CommandReport {
    packages?: unknown;
    summary?: unknown;
}
export interface MigrationDriver {
    convert(inputPath: string, outputDirectory: string, installDirectory: string): Promise<CommandReport>;
}
export interface MigratedToolMigrationServiceOptions {
    dataDirectory: string;
    command: string;
    refresh(): Promise<void>;
    driver?: MigrationDriver;
}
export declare class MigratedToolMigrationError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: ErrorOptions);
}
/** Owns upload staging and invokes the separately installed migration compiler. */
export declare class MigratedToolMigrationService {
    private readonly options;
    private readonly driver;
    constructor(options: MigratedToolMigrationServiceOptions);
    install(upload: DifyToolUpload): Promise<DifyToolMigrationResult>;
}
export {};
