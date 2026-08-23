// Client 侧全局声明（P01 最小集）。
//
// 提供 CSS module 声明，使 import styles from './x.module.css' 在 client
// program（tsconfig.client.json）内类型通过；client bundle 的实际 CSS 编译与
// style[data-plugin] 注入由 P02 的 tsdown（参照官方 tsdown.client.ts）负责，
// 此处仅提供构建期类型占位。

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

// 全局 CSS 声明（T-003）：允许 `import './x.css'` 的副作用导入（无导出），
// 供 tsdown 的全局 CSS 虚拟 loader（style[data-plugin] 注入）在 client program 内类型通过。
// 实际编译与注入由 scripts/build-client.ts 的 lightningcss 负责，此处仅类型占位。
declare module '*.css' {}
