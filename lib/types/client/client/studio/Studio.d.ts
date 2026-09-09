import type { Dict } from '../i18n.js';
import { type RemoteFace } from '../hooks/useRemote.js';
export interface StudioProps {
    /** 文案词典。 */
    t: Dict;
    /** 绑定的会话 id。 */
    sessionId: string;
    /** 远端调用面（测试注入；缺省 useRemote）。 */
    remote?: RemoteFace;
    /** 窗口关闭回调（标题栏 ×；浮窗宿主注入；对话视图挂载无关闭）。 */
    onClose?: () => void;
    /** 窗口拖动把手回调（浮窗注入；工作台标题顶栏兼任窗口标题栏拖动）。 */
    onTitlebarDrag?: (event: React.PointerEvent) => void;
    /** 视图模式（浮窗/分栏）；分栏时工作台初始折叠自身左右栏。 */
    viewMode?: 'float' | 'split';
    /** 标题栏窗口切换按钮回调（float↔split，宿主持久化）。 */
    onToggleView?: () => void;
    /** 运行联动：进入分栏模式（宿主持久化；配合运行触发）。 */
    onEnterSplit?: () => void;
}
export declare function Studio({ t, sessionId, remote: remoteProp, onClose, onTitlebarDrag, viewMode, onToggleView, onEnterSplit }: StudioProps): import("react").JSX.Element;
