// src/client/studio/studio-state.ts
//
// 工作台状态机入口（纯 reducer，可独立单测）：re-export 拆分子模块的
// 全部公共 API（类型/动作/初始状态/画布投影/图快照/reducer/选择器）。
// 外部引用方（useStudioState 等 hooks、各组件、tests）继续从此入口导入，
// 路径保持不变。
//
// 子模块职责：
//   studio-types.ts      类型定义层（纯类型）
//   studio-actions.ts    动作判别联合
//   studio-initial.ts    初始状态工厂
//   studio-projection.ts 文档 → 画布投影
//   studio-snapshot.ts   图快照工具
//   studio-reducer.ts    reducer 主体
//   studio-selectors.ts  派生数据选择器

export type * from './studio-types.js'
export type * from './studio-actions.js'
export * from './studio-initial.js'
export * from './studio-projection.js'
export * from './studio-snapshot.js'
export * from './studio-reducer.js'
export * from './studio-selectors.js'
