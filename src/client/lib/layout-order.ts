// src/client/lib/layout-order.ts
//
// 层内排序（交叉最小化；自主编排方案 §7.2 步骤 ⑤⑥）：重心/中位数启发式，纯函数。
//   - 输入：分层结果 + 排序单元尺寸（宽高）+ 邻接关系；
//   - 输出：每层内单元 id 的顺序（List<string[]>），用于坐标生成；
//   - 长边处理（步骤 ⑥）：相邻层之间的边才参与重心计算，跨层长边只记录端点层
//     （不插虚拟节点也能显著收敛交叉；坐标生成本来就按列独立，不依赖虚拟节点）。
// 确定性：每轮按「重心 → 上一轮序号（稳定键）」排序，同输入同输出，不读随机源。

/** 层内排序输入。 */
export interface OrderInput {
  /** 每层的单元 id（顺序 = 上一轮结果；首轮用输入顺序）。 */
  layers: string[][]
  /** 邻接（source → targets；仅同行向边）。 */
  adjacency: Map<string, string[]>
  /** 反向邻接（target → sources）。 */
  reverse: Map<string, string[]>
  /** 迭代轮数（默认 4；每轮 = 一次从左到右 + 一次从右到左）。 */
  rounds?: number
}

/** 默认迭代轮数（收益递减；4 轮已能显著收敛典型工作流）。 */
export const DEFAULT_ORDER_ROUNDS = 4

/** 计算某单元在参考层的平均位置（无邻居时返回 undefined）。 */
function barycenter(id: string, neighbours: string[], indexOf: Map<string, number>): number | undefined {
  let sum = 0
  let count = 0
  for (const other of neighbours) {
    const position = indexOf.get(other)
    if (position === undefined) continue
    sum += position
    count += 1
  }
  return count === 0 ? undefined : sum / count
}

/** 一轮扫描：固定参考层，重排目标层（无邻居的单元保持原位，稳定排序）。 */
function sweep(targetLayer: string[], referenceIndexOf: Map<string, number>, neighboursOf: (id: string) => string[]): string[] {
  const currentIndex = new Map(targetLayer.map((id, index) => [id, index]))
  const decorated = targetLayer.map((id) => {
    const center = barycenter(id, neighboursOf(id), referenceIndexOf)
    // 无邻居单元用「当前位置」当重心：既不打乱它，也不让它抢到最前（稳定）
    return { id, center: center ?? currentIndex.get(id) ?? 0, original: currentIndex.get(id) ?? 0 }
  })
  decorated.sort((a, b) => (a.center !== b.center ? a.center - b.center : a.original - b.original))
  return decorated.map((item) => item.id)
}

/**
 * 层内排序主函数：返回每层重排后的 id 顺序（行 = 层内并行，尽量少交叉）。
 * @returns 与输入 layers 等长的数组（每层顺序可能变化，集合不变）
 */
export function orderLayers(input: OrderInput): string[][] {
  const rounds = Math.max(0, Math.floor(input.rounds ?? DEFAULT_ORDER_ROUNDS))
  let layers = input.layers.map((layer) => [...layer])
  for (let round = 0; round < rounds; round += 1) {
    // 左 → 右：用上一层已更新的顺序作参考
    for (let index = 1; index < layers.length; index += 1) {
      const reference = new Map(layers[index - 1].map((id, position) => [id, position]))
      layers[index] = sweep(layers[index], reference, (id) => input.reverse.get(id) ?? [])
    }
    // 右 → 左：用下一层已更新的顺序作参考
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      const reference = new Map(layers[index + 1].map((id, position) => [id, position]))
      layers[index] = sweep(layers[index], reference, (id) => input.adjacency.get(id) ?? [])
    }
  }
  return layers
}
