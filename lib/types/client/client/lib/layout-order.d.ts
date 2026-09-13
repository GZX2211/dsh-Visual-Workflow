/** 层内排序输入。 */
export interface OrderInput {
    /** 每层的单元 id（顺序 = 上一轮结果；首轮用输入顺序）。 */
    layers: string[][];
    /** 邻接（source → targets；仅同行向边）。 */
    adjacency: Map<string, string[]>;
    /** 反向邻接（target → sources）。 */
    reverse: Map<string, string[]>;
    /** 迭代轮数（默认 4；每轮 = 一次从左到右 + 一次从右到左）。 */
    rounds?: number;
}
/** 默认迭代轮数（收益递减；4 轮已能显著收敛典型工作流）。 */
export declare const DEFAULT_ORDER_ROUNDS = 4;
/**
 * 层内排序主函数：返回每层重排后的 id 顺序（行 = 层内并行，尽量少交叉）。
 * @returns 与输入 layers 等长的数组（每层顺序可能变化，集合不变）
 */
export declare function orderLayers(input: OrderInput): string[][];
