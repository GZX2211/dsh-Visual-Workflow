import type { Dict } from '../i18n.js';
import { type RemoteFace } from '../hooks/useRemote.js';
import type { WorkspacePicker } from '../sidebar/workspace-picker.js';
export interface StudioProps {
    /** 文案词典。 */
    t: Dict;
    /** 绑定的会话 id。 */
    sessionId: string;
    /** 远端调用面（测试注入；缺省 useRemote）。 */
    remote?: RemoteFace;
    /**
     * 运行联动（沉浸式）：点击「运行」时由宿主执行「让出空间」动作。
     * 0.1.5-rc.1 迁移后语义 = 若官方右侧 Sidebar 处于全屏则缩回普通态（非全屏保持原状）；
     * 之前是「切到插件自己的分栏视图模式」，该模式已随浮窗/分栏整体删除。
     */
    onRunImmersive?: () => void;
    /**
     * 官方目录选择器（宿主接入层组装；缺省 = 当前环境没有可用选择器）。
     * 业务组件不直接触达官方服务，宿主能力经此注入面进入工作台。
     */
    workspacePicker?: WorkspacePicker | null;
}
export declare function Studio({ t, sessionId, remote: remoteProp, onRunImmersive, workspacePicker }: StudioProps): import("react").JSX.Element;
