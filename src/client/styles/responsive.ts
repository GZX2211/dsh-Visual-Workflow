// src/client/styles/responsive.ts
//
// 窄屏适配。1180px / 760px 两档媒体查询，覆盖上面各域（状态文案 / 顶栏 / 标签页 / 工具栏 / 按钮）。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const responsiveStyles = `
/* 官方右侧 Sidebar 自行管理列几何（grid track / 全屏 / 折叠滑动 / 分栏），插件不再触碰官方
   frame 网格与对话主列内边距（0.1.5-rc.1 迁移：浮窗与分栏视图模式已整体删除）。 */
@media (max-width: 1180px) {
  .wf-status {
    display: none;
  }

  .wf-titlebar__note {
    display: none;
  }
}

@media (max-width: 760px) {
  .wf-toolbar {
    padding: 7px;
  }

  .wf-tabs {
    padding: 0 10px;
  }

  .wf-titlebar__badge {
    display: none;
  }

  .wf-lib-tab {
    font-size: 10px;
  }

  .wf-confirm__actions .wf-btn {
    flex: 1;
  }
}
`
