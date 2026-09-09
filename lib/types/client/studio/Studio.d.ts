import type { Dict } from '../i18n.js';
import { type RemoteFace } from '../hooks/useRemote.js';
import { type LibTab } from './studio-state.js';
export interface StudioProps {
    /** 文案词典。 */
    t: Dict;
    /** 绑定的会话 id。 */
    sessionId: string;
    /** 远端调用面（测试注入；缺省 useRemote）。 */
    remote?: RemoteFace;
}
/** 左侧栏四 Tab（workflow/role/file/database）。 */
export declare const LIB_TABS: Array<{
    key: LibTab;
    label: string;
}>;
export declare function Studio({ t, sessionId, remote: remoteProp }: StudioProps): import("react").JSX.Element;
