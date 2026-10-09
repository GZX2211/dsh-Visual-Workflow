import type { Dict } from "../i18n.js";
import { type RemoteCallOptions } from "../lib/remote.js";
export interface RemoteFace {
    /** POST /visual-workflow/<endpoint>, body { args }, returning value. */
    call(endpoint: string, args?: Record<string, unknown>, options?: RemoteCallOptions): Promise<unknown>;
    /** SSE call for service debugging; lifecycle is controlled by signal. */
    stream(endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void>;
}
/** Stable remote-call face; dictionary changes replace only the error-copy mapping. */
export declare function useRemote(copy: Dict): RemoteFace;
