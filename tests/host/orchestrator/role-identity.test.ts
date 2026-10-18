// tests/host/orchestrator/role-identity.test.ts
//
// 角色身份推导：经验退役的「跨角色多样性」依赖一个稳定的角色键，而角色节点没有统一 roleId。
// 本测试锁定口径：角色资产 id 优先（asset:），否则人工命名的角色名（label:），
// 两者都没有时为空身份（不参与长期无用判定，也不伪造角色）。

import { describe, expect, it } from "vitest"
import type { RoleNode, WorkflowDocument } from "../../../src/host/shared/graph-model.js"
import { parentRoleIdentityOf, roleIdentityOf } from "../../../src/host/orchestrator/role-identity.js"

function roleNode(id: string, kind: "agent" | "parent", data: Partial<RoleNode["data"]> = {}): RoleNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: {
      label: "开发",
      systemPrompt: "角色提示词",
      provider: "",
      model: "",
      retryLimit: 3,
      ...data,
    },
  }
}

describe("角色身份推导", () => {
  it("test_角色资产id优先_角色名仅作展示", () => {
    expect(roleIdentityOf(roleNode("n1", "agent", { sourceAssetId: "role-abc", label: "后端开发" }))).toEqual({
      roleKey: "asset:role-abc",
      roleLabel: "后端开发",
    })
  })

  it("test_无角色资产id_退化为角色名并归一空白", () => {
    expect(roleIdentityOf(roleNode("n1", "agent", { label: "  后端   开发  " }))).toEqual({
      roleKey: "label:后端 开发",
      roleLabel: "后端 开发",
    })
  })

  it("test_角色资产id两端空白被归一", () => {
    expect(roleIdentityOf(roleNode("n1", "agent", { sourceAssetId: "  role-abc  " }))).toEqual({
      roleKey: "asset:role-abc",
      roleLabel: "开发",
    })
  })

  it("test_无资产id且角色名为空_返回空身份（不伪造角色）", () => {
    expect(roleIdentityOf(roleNode("n1", "agent", { label: "   " }))).toEqual({ roleKey: "", roleLabel: "" })
  })

  it("test_父代理节点使用同一套身份口径", () => {
    expect(roleIdentityOf(roleNode("n-parent", "parent", { sourceAssetId: "role-parent" }))).toEqual({
      roleKey: "asset:role-parent",
      roleLabel: "开发",
    })
  })

  it("test_流程无父代理节点_返回空身份", () => {
    const flow: WorkflowDocument = {
      id: "flow-1",
      sessionId: "session-1",
      mode: "mode1",
      name: "流程",
      description: "",
      revision: 1,
      nodes: [roleNode("n-a1", "agent")],
      lines: [],
    }

    expect(parentRoleIdentityOf(flow)).toEqual({ roleKey: "", roleLabel: "" })
  })

  it("test_流程有父代理节点_取父代理角色身份", () => {
    const flow: WorkflowDocument = {
      id: "flow-1",
      sessionId: "session-1",
      mode: "mode1",
      name: "流程",
      description: "",
      revision: 1,
      nodes: [roleNode("n-parent", "parent", { sourceAssetId: "role-parent" }), roleNode("n-a1", "agent")],
      lines: [],
    }

    expect(parentRoleIdentityOf(flow)).toEqual({ roleKey: "asset:role-parent", roleLabel: "开发" })
  })
})
