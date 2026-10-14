import type { RemoteFace } from './useRemote.js';
/** 订阅宿主下发的 Team 成员上限；请求中止与卸载校验由本 effect 负责。 */
export declare function useTeamMemberLimit(remote: RemoteFace): number;
