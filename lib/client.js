window.__ModuleLoader__.load({
	id: "dsh-visual-workflow",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_dom_client = require("react-dom/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/studio/floating-window.tsx
		/** 默认几何（视口右下偏上居中）。 */
		const DEFAULT_WINDOW_BOUNDS = {
			x: 120,
			y: 60,
			w: 960,
			h: 640
		};
		/** 几何持久化键。 */
		const WINDOW_BOUNDS_KEY = "visual-workflow:window-bounds";
		/** 恢复记忆几何（损坏/越界回退默认；导出供 WorkbenchFrame 复用）。 */
		function restoreBounds() {
			try {
				const raw = localStorage.getItem(WINDOW_BOUNDS_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					const w = Number(parsed.w) || DEFAULT_WINDOW_BOUNDS.w;
					const h = Number(parsed.h) || DEFAULT_WINDOW_BOUNDS.h;
					const x = Number(parsed.x);
					const y = Number(parsed.y);
					const width = Math.max(480, Math.min(w, window.innerWidth - 40));
					const height = Math.max(320, Math.min(h, window.innerHeight - 40));
					return {
						x: Number.isFinite(x) ? Math.max(0, Math.min(x, window.innerWidth - width)) : DEFAULT_WINDOW_BOUNDS.x,
						y: Number.isFinite(y) ? Math.max(0, Math.min(y, window.innerHeight - height)) : DEFAULT_WINDOW_BOUNDS.y,
						w: width,
						h: height
					};
				}
			} catch {}
			return { ...DEFAULT_WINDOW_BOUNDS };
		}
		function keepBounds(bounds) {
			try {
				localStorage.setItem(WINDOW_BOUNDS_KEY, JSON.stringify(bounds));
			} catch {}
		}
		/** 标题栏/缩放把手内的可交互节点（按钮等）不触发拖动。 */
		function isInteractive(target) {
			const element = target;
			if (!element?.closest) return false;
			return Boolean(element.closest("button, input, select, textarea, a"));
		}
		/** 几何钳制：视口内定位；尺寸最小 480×320、最大 = 视口（防延展超出浏览器）。 */
		function clampBounds(next) {
			const maxW = Math.max(480, window.innerWidth - 8);
			const maxH = Math.max(320, window.innerHeight - 8);
			const w = Math.min(maxW, Math.max(480, next.w));
			const h = Math.min(maxH, Math.max(320, next.h));
			const maxX = Math.max(0, window.innerWidth - w);
			const maxY = Math.max(0, window.innerHeight - h);
			return {
				x: Math.max(0, Math.min(next.x, maxX)),
				y: Math.max(0, Math.min(next.y, maxY)),
				w,
				h
			};
		}
		/**
		* FAB + 浮窗宿主：FAB 固定右下角；打开后渲染可拖动/可缩放的窗口。
		* 几何状态本地管理（与工作台状态机解耦），持久化记忆。
		*/
		function FloatingWindow({ t, open, onClose, children }) {
			const [bounds, setBounds] = (0, react.useState)(() => restoreBounds());
			const windowRef = (0, react.useRef)(null);
			/** 几何 CSSProperties：固定引用（React 重渲染跳过该 style diff，不覆盖直写值）。 */
			const styleRef = (0, react.useRef)({});
			/** 活动会话（唯一；常驻监听器读取）。 */
			const sessionRef = (0, react.useRef)(null);
			/** 会话期间的 body 样式快照（常驻监听器在会话结束时恢复）。 */
			const bodyRestoreRef = (0, react.useRef)(null);
			styleRef.current = {
				left: `${bounds.x}px`,
				top: `${bounds.y}px`,
				width: `${bounds.w}px`,
				height: `${bounds.h}px`
			};
			/**
			* 同步几何（唯一写路径）：
			*  - el.style 直接写（DOM 层，React 不感知，move 期间零重渲染）；
			*  - styleRef 整体替换为新对象（绝不修改 React 已看过的对象——React dev 会冻结它）。
			*/
			const applyGeometry = (0, react.useCallback)((next) => {
				const el = windowRef.current;
				if (el) {
					el.style.left = `${next.x}px`;
					el.style.top = `${next.y}px`;
					el.style.width = `${next.w}px`;
					el.style.height = `${next.h}px`;
				}
				styleRef.current = {
					left: `${next.x}px`,
					top: `${next.y}px`,
					width: `${next.w}px`,
					height: `${next.h}px`
				};
			}, []);
			/** 提交几何（状态 + DOM + 持久化）。 */
			const commitBounds = (0, react.useCallback)((next) => {
				const clamped = clampBounds(next);
				applyGeometry(clamped);
				setBounds(clamped);
				keepBounds(clamped);
			}, [applyGeometry]);
			(0, react.useEffect)(() => {
				const onPointerMove = (event) => {
					const session = sessionRef.current;
					if (!session || event.pointerId !== session.pointerId) return;
					const dx = event.clientX - session.lastX;
					const dy = event.clientY - session.lastY;
					session.lastX = event.clientX;
					session.lastY = event.clientY;
					if (dx === 0 && dy === 0) return;
					const base = session.bounds;
					let next;
					if (session.kind === "drag") next = {
						...base,
						x: base.x + dx,
						y: base.y + dy
					};
					else {
						let { x, y, w, h } = base;
						const direction = session.direction ?? "se";
						if (direction.includes("e")) w = Math.max(480, w + dx);
						if (direction.includes("s")) h = Math.max(320, h + dy);
						if (direction.includes("w")) {
							w = Math.max(480, w - dx);
							x = base.x + (base.w - w);
						}
						if (direction.includes("n")) {
							h = Math.max(320, h - dy);
							y = base.y + (base.h - h);
						}
						next = {
							x,
							y,
							w,
							h
						};
					}
					const clamped = clampBounds(next);
					session.bounds = clamped;
					applyGeometry(clamped);
				};
				const endSession = (event) => {
					const session = sessionRef.current;
					if (!session) return;
					if (event.pointerId !== session.pointerId) return;
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
					commitBounds(session.bounds);
				};
				const onBlur = () => {
					const session = sessionRef.current;
					if (!session) return;
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
					commitBounds(session.bounds);
				};
				window.addEventListener("pointermove", onPointerMove);
				window.addEventListener("pointerup", endSession);
				window.addEventListener("pointercancel", endSession);
				window.addEventListener("blur", onBlur);
				return () => {
					window.removeEventListener("pointermove", onPointerMove);
					window.removeEventListener("pointerup", endSession);
					window.removeEventListener("pointercancel", endSession);
					window.removeEventListener("blur", onBlur);
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
				};
			}, [applyGeometry, commitBounds]);
			/** 标题栏拖动开始（登记会话 + Pointer Capture；按钮/输入目标忽略）。 */
			const beginDrag = (0, react.useCallback)((event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				if (isInteractive(event.target ?? null)) return;
				event.preventDefault?.();
				const pointerId = Number(event.pointerId) || 0;
				const target = event.currentTarget;
				try {
					target?.setPointerCapture?.(pointerId);
				} catch {}
				bodyRestoreRef.current = {
					cursor: document.body.style.cursor,
					userSelect: document.body.style.userSelect
				};
				document.body.style.cursor = "move";
				document.body.style.userSelect = "none";
				sessionRef.current = {
					kind: "drag",
					pointerId,
					lastX: event.clientX,
					lastY: event.clientY,
					bounds
				};
			}, [bounds]);
			/** 八方向缩放开始（同上）。 */
			const beginResize = (0, react.useCallback)((direction, event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				event.preventDefault?.();
				const pointerId = Number(event.pointerId) || 0;
				const target = event.currentTarget;
				try {
					target?.setPointerCapture?.(pointerId);
				} catch {}
				bodyRestoreRef.current = {
					cursor: document.body.style.cursor,
					userSelect: document.body.style.userSelect
				};
				document.body.style.cursor = "se-resize";
				document.body.style.userSelect = "none";
				sessionRef.current = {
					kind: "resize",
					pointerId,
					lastX: event.clientX,
					lastY: event.clientY,
					bounds,
					direction
				};
			}, [bounds]);
			(0, react.useEffect)(() => {
				if (!open) return;
				commitBounds(bounds);
			}, [open]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: windowRef,
				className: "wf-window",
				style: styleRef.current,
				"data-wf-window": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-window__body",
					children: children({
						close: onClose,
						drag: beginDrag
					})
				}), [
					"n",
					"s",
					"e",
					"w",
					"ne",
					"nw",
					"se",
					"sw"
				].map((direction) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: `wf-window__resize is-${direction}`,
					"data-direction": direction,
					onPointerDown: (event) => beginResize(direction, event)
				}, direction))]
			}) : null });
		}
		//#endregion
		//#region src/client/studio/studio-initial.ts
		/** 初始面板几何：默认「左栏展开」（折叠切换循环位置 0），右侧属性栏默认隐藏（由选中推导）。
		*  底栏默认高度 170px，左右两侧栏默认宽度 230px（用户裁决）。 */
		function defaultPanels() {
			return {
				mode: 0,
				leftWidth: 230,
				rightWidth: 230,
				bottomHeight: 170
			};
		}
		/** 初始状态（会话 id 由调用方注入）。 */
		function createInitialState(sessionId) {
			return {
				sessionId,
				libTab: "workflow",
				mode: "mode1",
				workflows: [],
				services: [],
				activeRuns: [],
				instanceOptions: {
					newSession: false,
					workspacePath: ""
				},
				flowTemplates: [],
				templates: {
					role: [],
					file: [],
					database: [],
					group: []
				},
				combos: [],
				presets: [],
				tools: [],
				models: [],
				currentId: null,
				currentKind: null,
				canvas: {
					nodes: [],
					edges: []
				},
				selection: {
					nodeId: null,
					edgeId: null,
					lib: null
				},
				editor: null,
				dirty: false,
				savedGraph: null,
				run: {
					runId: null,
					sessionId: null,
					snapshot: null
				},
				toasts: [],
				message: "",
				history: {
					past: [],
					future: []
				},
				panels: defaultPanels(),
				confirm: null,
				historyOpen: false,
				runHistory: [],
				selectedRunId: null,
				comboOpen: false,
				schedulerOpen: false
			};
		}
		//#endregion
		//#region src/client/lib/graph-model.ts
		const HANDLES = {
			parent: {
				inputs: [
					"db-in",
					"ctx-in",
					"flow-in"
				],
				outputs: ["ctx-out", "flow-out"]
			},
			agent: {
				inputs: [
					"db-in",
					"ctx-in",
					"flow-in"
				],
				outputs: ["ctx-out", "flow-out"]
			},
			proxy: {
				inputs: [
					"db-in",
					"ctx-in",
					"flow-in"
				],
				outputs: ["ctx-out", "flow-out"]
			},
			file: {
				inputs: [],
				outputs: ["ctx-out"]
			},
			database: {
				inputs: [],
				outputs: ["db-out"]
			},
			start: {
				inputs: [],
				outputs: ["flow-out"]
			},
			end: {
				inputs: ["flow-in"],
				outputs: []
			},
			pause: {
				inputs: ["flow-in"],
				outputs: ["flow-out"]
			},
			group: {
				inputs: ["flow-in"],
				outputs: ["flow-out"]
			}
		};
		/** 阶段节点显示名（模式一：启动/结束；模式二：输入/输出，需求 §4.2.5.1）。 */
		function stageLabels(mode) {
			const isMode2 = mode === "mode2";
			return {
				start: isMode2 ? "输入" : "启动",
				end: isMode2 ? "输出" : "结束",
				pause: "暂停"
			};
		}
		/** 阶段节点固定卡片（模式二没有暂停，需求 §4.2.5.1 规则 1/2）。 */
		function stageTemplateKinds(mode) {
			const labels = stageLabels(mode);
			const out = [{
				kind: "start",
				label: labels.start
			}, {
				kind: "end",
				label: labels.end
			}];
			if (mode !== "mode2") out.push({
				kind: "pause",
				label: labels.pause
			});
			return out;
		}
		function defaultOutputHandle(kind) {
			const def = HANDLES[kind] ?? HANDLES.agent;
			return def.outputs[def.outputs.length - 1] ?? "flow-out";
		}
		function defaultInputHandle(kind) {
			const def = HANDLES[kind] ?? HANDLES.agent;
			return def.inputs[def.inputs.length - 1] ?? "flow-in";
		}
		/** 条件连线标签（需求 §4.3 连线类型表）。 */
		function conditionLabel(condition) {
			if (!condition) return "";
			if (condition.type === "pass") return "[通过]";
			if (condition.type === "fail") return "[不通过]";
			if (condition.type === "content") return `[${String(condition.label ?? "内容").slice(0, 12)}]`;
			return "";
		}
		/** 连线颜色 class（flow 默认 / ctx / db / 条件 pass|fail|content）。 */
		function lineColorClass(line) {
			const sourceHandle = line?.sourceHandle ?? "";
			const targetHandle = line?.targetHandle ?? "";
			if (sourceHandle === "db-out" || targetHandle === "db-in") return "is-db";
			if (sourceHandle === "ctx-out" || targetHandle === "ctx-in") return "is-ctx";
			const condition = line?.condition?.type;
			if (condition === "pass") return "is-pass";
			if (condition === "fail") return "is-fail";
			if (condition === "content") return "is-content";
			return "";
		}
		/** 模板字段 → 节点 data（深拷贝快照；模板 name → 节点 label，共享类型逐字段对齐）。
		*  kind 限定 role/file/database；传入 GroupTemplate 时按 None 处理（协作组模板走
		*  placeGroupFromTemplate，不进本函数）。 */
		function templateToNodeData(kind, template) {
			if (!template) return null;
			const label = String(template.name ?? "").trim() ? String(template.name) : "";
			if (kind === "role") {
				const role = template;
				return {
					label,
					systemPrompt: String(role.systemPrompt ?? ""),
					provider: String(role.provider ?? ""),
					model: String(role.model ?? ""),
					reasoning: role.reasoning ?? null,
					presetId: role.presetId ?? "standard",
					retryLimit: Number(role.retryLimit ?? 3),
					reactLimit: role.reactLimit ?? null,
					inputSchema: String(role.inputSchema ?? ""),
					outputSchema: String(role.outputSchema ?? ""),
					injectSystemPrompt: role.injectSystemPrompt !== false,
					injectToolSections: role.injectToolSections !== false,
					promptFilePath: String(role.promptFilePath ?? "") || void 0,
					groupId: null
				};
			}
			if (kind === "file") {
				const file = template;
				const managedPath = String(file.managedPath ?? "");
				const files = Array.isArray(file.files) && file.files.length > 0 ? file.files.map((item) => ({
					fileName: String(item?.fileName ?? ""),
					managedPath: String(item?.managedPath ?? "")
				})) : [];
				return {
					label,
					fileKind: file.fileKind === "file" ? "file" : "text",
					content: String(file.content ?? ""),
					managedPath: managedPath || void 0,
					fileName: String(managedPath ? managedPath.split(/[\\/]/).pop() : ""),
					...files.length > 0 ? { files } : {}
				};
			}
			const db = template;
			return {
				label,
				description: String(db.description ?? ""),
				dbType: db.dbType === "server" ? "server" : "local",
				dbKind: db.dbKind ?? "sqlite",
				localPath: String(db.localPath ?? ""),
				conn: db.conn ? { ...db.conn } : void 0,
				vectorSource: db.vectorSource === "bm25" ? "bm25" : "embedding"
			};
		}
		/** 画布节点 kind 统一读取（顶层 kind 优先，兼容 data.kind 历史数据）。 */
		function nodeKindOf(node) {
			return node?.kind ?? node?.data?.kind ?? "agent";
		}
		/** flow → 画布连线（line 条件对象 → 显示标签/颜色）。 */
		function flowToCanvasLines(lines) {
			return (lines ?? []).map((line) => ({
				...line,
				lineType: lineColorClass(line),
				label: line.condition?.type ? conditionLabel(line.condition) : ""
			}));
		}
		/** 连接校验：在画布上建立一条连线（sourceHandle → targetHandle）。 */
		function connectionProblem(nodes, lines, connection) {
			if (!connection?.source || !connection?.target) return {
				valid: false,
				code: "invalidConnection"
			};
			if (connection.source === connection.target) return {
				valid: false,
				code: "selfLoop"
			};
			const source = nodes.find((node) => node.id === connection.source);
			const target = nodes.find((node) => node.id === connection.target);
			if (!source || !target) return {
				valid: false,
				code: "invalidConnection"
			};
			const sourceKind = nodeKindOf(source);
			const targetKind = nodeKindOf(target);
			const sourceHandle = connection.sourceHandle ?? defaultOutputHandle(sourceKind);
			const targetHandle = connection.targetHandle ?? defaultInputHandle(targetKind);
			const sourceDef = HANDLES[sourceKind] ?? HANDLES.agent;
			const targetDef = HANDLES[targetKind] ?? HANDLES.agent;
			if (!sourceDef.outputs.includes(sourceHandle)) return {
				valid: false,
				code: "invalidHandle"
			};
			if (!targetDef.inputs.includes(targetHandle)) return {
				valid: false,
				code: "invalidHandle"
			};
			const channel = sourceHandle.replace(/-out$/, "");
			if (targetHandle !== `${channel}-in`) return {
				valid: false,
				code: "channelMismatch"
			};
			const memberSource = (sourceKind === "parent" || sourceKind === "agent") && Boolean(source.data?.groupId);
			const memberTarget = (targetKind === "parent" || targetKind === "agent") && Boolean(target.data?.groupId);
			if (channel === "flow" && (memberSource || memberTarget)) return {
				valid: false,
				code: "groupMemberFlow"
			};
			if (targetKind === "start") return {
				valid: false,
				code: "startInput"
			};
			if (sourceKind === "end") return {
				valid: false,
				code: "endOutput"
			};
			const relatedOf = (node) => {
				if (node.kind === "proxy") return nodes.filter((item) => item.id === node.proxySourceId || item.kind === "proxy" && item.proxySourceId === node.proxySourceId);
				if (node.kind === "parent" || node.kind === "agent") return nodes.filter((item) => item.kind === "proxy" && item.proxySourceId === node.id);
				return [];
			};
			for (const node of [source, target]) for (const other of relatedOf(node)) if (lines.some((line) => line.source === other.id && line.target === target.id && (line.sourceHandle ?? "") === sourceHandle && (line.targetHandle ?? "") === targetHandle || line.source === source.id && line.target === other.id && (line.sourceHandle ?? "") === sourceHandle && (line.targetHandle ?? "") === targetHandle)) return {
				valid: false,
				code: "proxyParallel"
			};
			if (lines.some((line) => line.source === connection.source && line.target === connection.target && (line.sourceHandle ?? "") === sourceHandle && (line.targetHandle ?? "") === targetHandle && line.id !== connection.lineId)) return {
				valid: false,
				code: "duplicateConnection"
			};
			return {
				valid: true,
				code: "ok",
				branch: sourceHandle
			};
		}
		function connectionProblemMessage(problem, copy) {
			if (!problem || problem.valid) return "";
			return {
				selfLoop: copy.selfLoop ?? "",
				duplicateConnection: copy.duplicateConnection ?? "",
				proxyParallel: copy.proxyParallel ?? copy.invalidConnection ?? "",
				channelMismatch: copy.invalidConnection ?? "",
				groupMemberFlow: copy.groupMemberFlowLine ?? copy.invalidConnection ?? "",
				startInput: copy.invalidConnection ?? "",
				endOutput: copy.invalidConnection ?? "",
				invalidHandle: copy.invalidConnection ?? "",
				invalidConnection: copy.invalidConnection ?? ""
			}[problem.code] ?? copy.invalidConnection ?? "";
		}
		/** 层次布局：按 flow 边拓扑排序分列排布（照搬旧项目 layoutNodes；泛型保留节点形状）。 */
		function layoutNodes(nodes, lines) {
			return layoutGraph(nodes, lines, (line) => line.sourceHandle === "flow-out");
		}
		/** 布局原语：可传边缘筛选函数。 */
		function layoutGraph(nodes, lines, channelFilter) {
			const edges = (lines ?? []).filter((line) => channelFilter(line));
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const indegree = new Map(nodes.map((node) => [node.id, 0]));
			const outgoing = new Map(nodes.map((node) => [node.id, []]));
			for (const edge of edges) {
				if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
				indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
				outgoing.get(edge.source)?.push(edge.target);
			}
			const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
			const level = new Map(queue.map((id) => [id, 0]));
			const order = [];
			while (queue.length) {
				const id = queue.shift();
				order.push(id);
				for (const next of outgoing.get(id) ?? []) {
					level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1));
					indegree.set(next, (indegree.get(next) ?? 0) - 1);
					if (indegree.get(next) === 0) queue.push(next);
				}
			}
			nodes.forEach((node) => {
				if (!level.has(node.id)) {
					const maxLevel = order.length > 0 ? Math.max(...level.values()) : -1;
					level.set(node.id, maxLevel + 1);
				}
			});
			const rows = /* @__PURE__ */ new Map();
			const stepX = 270;
			const stepY = 180;
			return nodes.map((node) => {
				const column = level.get(node.id) ?? 0;
				const row = rows.get(column) ?? 0;
				rows.set(column, row + 1);
				return {
					...node,
					position: {
						x: 70 + column * stepX,
						y: 80 + row * stepY
					}
				};
			});
		}
		/** 运行快照 → 节点状态映射（画布回显用）。 */
		function runStatusMap(snapshot) {
			const map = {};
			for (const node of snapshot?.nodes ?? []) if (node?.nodeId) map[node.nodeId] = {
				status: node.status,
				attempts: node.attempts,
				outputSummary: node.outputSummary
			};
			return map;
		}
		/** 运行中节点 id 列表（需求 §4.5.8「当前运行节点高亮」；画布高亮数据源，防回环只写视图）。 */
		function runningNodeIds(snapshot) {
			return (snapshot?.nodes ?? []).filter((node) => node?.nodeId && node.status === "running").map((node) => node.nodeId);
		}
		/**
		* 合并重复节点（修复历史数据中协作组节点被重复追加的缺陷）：
		*  - 同 id 的协作组节点合并为一个，memberIds 取**并集**（不丢任何成员），其余字段保留后出现者；
		*  - 每个协作组节点的 memberIds **一律去重**（即便单组内出现重复 id，也会被清理）。
		* 非协作组节点同 id 直接保留最后出现者。返回合并后的新数组。
		*/
		function consolidateGroups(nodes) {
			const result = [];
			const indexBy = /* @__PURE__ */ new Map();
			const forEachNode = (node) => {
				const idx = indexBy.get(node.id);
				if (idx === void 0) {
					indexBy.set(node.id, result.length);
					result.push(node);
					return;
				}
				const existing = result[idx];
				const nodeKind = node.kind;
				if (existing.kind === "group" && nodeKind === "group") {
					const union = [.../* @__PURE__ */ new Set([...Array.isArray(existing.data.memberIds) ? existing.data.memberIds : [], ...Array.isArray(node.data.memberIds) ? node.data.memberIds : []])];
					result[idx] = {
						...node,
						data: {
							...node.data,
							memberIds: union
						}
					};
				} else result[idx] = node;
			};
			return (() => {
				for (const node of nodes) forEachNode(node);
				return result;
			})().map((n) => n.kind === "group" ? {
				...n,
				data: {
					...n.data,
					memberIds: [...new Set(Array.isArray(n.data.memberIds) ? n.data.memberIds : [])]
				}
			} : n);
		}
		/**
		* 原子入组：一次变更同时设置「成员节点 data.groupId」与「协作组 data.memberIds（追加去重）」。
		* 入组限定角色节点（parent/agent），返回新 nodes 数组；非角色/非组则原样返回。
		* 先把重复的协作组节点合并（并集），再在**唯一**的组上追加，杜绝「删 1 个移出多个 / 只显示一个」的不一致。
		* 供左栏模板拖入与画布内节点拖入两条路径共用。
		*/
		function joinNodeToGroup(nodes, nodeId, groupId) {
			const base = consolidateGroups(nodes);
			const node = base.find((n) => n.id === nodeId);
			const group = base.find((n) => n.id === groupId);
			const nodeKind = node?.kind;
			const groupKind = group?.kind;
			if (!node || !group || groupKind !== "group") return base;
			if (nodeKind !== "parent" && nodeKind !== "agent") return base;
			const members = Array.isArray(group.data.memberIds) ? group.data.memberIds : [];
			const nextMembers = members.includes(nodeId) ? members : [...members, nodeId];
			return base.map((n) => {
				if (n.id === nodeId) return {
					...n,
					data: {
						...n.data,
						groupId
					}
				};
				if (n.id === groupId) return {
					...n,
					data: {
						...n.data,
						memberIds: nextMembers
					}
				};
				return n;
			});
		}
		/**
		* 移除指定节点的流程连线（角色拖入协作组后仅保留上下文/数据库线，§4.2.5.2 规则 4）：
		* 组内成员只有上下文/数据库连接点，无流程接点；已连的流程线在入组时自动断开。
		*/
		function dropNodeFlowLines(lines, nodeId) {
			return lines.filter((line) => !(line.source === nodeId && (line.sourceHandle ?? "") === "flow-out" || line.target === nodeId && (line.targetHandle ?? "") === "flow-in"));
		}
		//#endregion
		//#region src/client/studio/studio-projection.ts
		/** 工作流文档/模板 → 画布投影（节点全量内联，位置缺省落默认格点）。 */
		function flowToCanvas(flow) {
			return {
				nodes: consolidateGroups((flow.nodes ?? []).map((node) => ({
					id: node.id,
					kind: node.kind,
					position: node.position ?? {
						x: 120,
						y: 80
					},
					data: node.data ?? {},
					...node.proxySourceId !== void 0 ? { proxySourceId: node.proxySourceId } : {}
				}))),
				edges: (flow.lines ?? []).map((line) => ({
					id: line.id,
					source: line.source,
					target: line.target,
					sourceHandle: line.sourceHandle,
					targetHandle: line.targetHandle,
					...line.condition ? { condition: line.condition } : {}
				}))
			};
		}
		/** 服务文档 → 画布投影（与工作流同构）。 */
		function serviceToCanvas(service) {
			return {
				nodes: consolidateGroups((service.nodes ?? []).map((node) => ({
					id: node.id,
					kind: node.kind,
					position: node.position ?? {
						x: 120,
						y: 80
					},
					data: node.data ?? {},
					...node.proxySourceId !== void 0 ? { proxySourceId: node.proxySourceId } : {}
				}))),
				edges: (service.lines ?? []).map((line) => ({
					id: line.id,
					source: line.source,
					target: line.target,
					sourceHandle: line.sourceHandle,
					targetHandle: line.targetHandle,
					...line.condition ? { condition: line.condition } : {}
				}))
			};
		}
		//#endregion
		//#region src/client/studio/studio-snapshot.ts
		/**
		* 当前图快照（撤销重做栈元素构造）。
		* 必须产出与 state.canvas 完全独立的副本：历史栈（past/future）保存的是
		* 「图标量」而非引用——若直接返回数组/对象引用，任何后续对 canvas 节点的
		* 原地修改（拖拽缓存、组件副作用）都会污染历史记录，undo/redo 退化为
		* 同一对象的覆盖式恢复（撤销失效）。考虑 node.data/edge.condition 为嵌套
		* 对象，逐层浅拷贝断开引用即可（元素内容不可变约定下即快照语义）。
		*/
		function graphSnapshotOf(state) {
			return {
				nodes: state.canvas.nodes.map((node) => ({
					...node,
					position: { ...node.position },
					data: { ...node.data }
				})),
				edges: state.canvas.edges.map((edge) => ({
					...edge,
					...edge.condition ? { condition: { ...edge.condition } } : {}
				}))
			};
		}
		/**
		* 图快照是否一致（Bug 17 的 dirty 精确判定用）。
		* 快照元素均为「内容不可变」结构（节点位置/数据、连线/条件），
		* 直接序列化比较即可（节点/连线顺序即文档事实源顺序）。
		*/
		function graphSnapshotsEqual(a, b) {
			if (a === b) return true;
			if (!a || !b) return false;
			return JSON.stringify(a) === JSON.stringify(b);
		}
		//#endregion
		//#region src/client/studio/studio-reducer.ts
		/** 打开工作流/服务/模板时的选中与编辑器重置（可选保留画布选择）。 */
		function openDocument(state, canvas, kind, id) {
			const libKind = kind === "workflow" ? "workflow" : kind === "service" ? "service" : "workflowTemplate";
			const editor = kind === "workflow" ? {
				source: "workflow",
				id
			} : kind === "service" ? {
				source: "service",
				id
			} : {
				source: "flowTemplate",
				id
			};
			return {
				...state,
				currentKind: kind,
				currentId: id,
				canvas,
				dirty: false,
				savedGraph: graphSnapshotOf({
					...state,
					canvas
				}),
				run: {
					runId: null,
					sessionId: null,
					snapshot: null
				},
				selection: {
					nodeId: null,
					edgeId: null,
					lib: {
						kind: libKind,
						id
					}
				},
				editor
			};
		}
		function studioReducer(state, action) {
			switch (action.type) {
				case "SET_SESSION": return {
					...state,
					sessionId: action.sessionId
				};
				case "SET_MODE": return {
					...state,
					mode: action.mode
				};
				case "SET_LIB_TAB": return {
					...state,
					libTab: action.tab
				};
				case "WORKFLOWS_LOADED": return {
					...state,
					workflows: action.items
				};
				case "WORKFLOW_ADDED": return {
					...state,
					workflows: [action.flow, ...state.workflows]
				};
				case "WORKFLOW_UPDATED": return {
					...state,
					workflows: state.workflows.map((flow) => flow.id === action.flow.id ? action.flow : flow)
				};
				case "WORKFLOW_REMOVED": return {
					...state,
					workflows: state.workflows.filter((flow) => flow.id !== action.id)
				};
				case "FLOW_TEMPLATES_LOADED": return {
					...state,
					flowTemplates: action.items
				};
				case "FLOW_TEMPLATE_ADDED": return {
					...state,
					flowTemplates: [action.template, ...state.flowTemplates]
				};
				case "FLOW_TEMPLATE_UPDATED": return {
					...state,
					flowTemplates: state.flowTemplates.map((template) => template.id === action.template.id ? action.template : template)
				};
				case "FLOW_TEMPLATE_REMOVED": return {
					...state,
					flowTemplates: state.flowTemplates.filter((template) => template.id !== action.id)
				};
				case "SERVICES_LOADED": return {
					...state,
					services: action.items
				};
				case "SERVICE_UPDATED": return {
					...state,
					services: state.services.map((service) => service.id === action.service.id ? action.service : service)
				};
				case "SERVICE_REMOVED": return {
					...state,
					services: state.services.filter((service) => service.id !== action.id)
				};
				case "ACTIVE_RUNS_LOADED": return {
					...state,
					activeRuns: action.items
				};
				case "INSTANCE_OPTIONS_SET": return {
					...state,
					instanceOptions: {
						...state.instanceOptions,
						...action.options
					}
				};
				case "TEMPLATES_LOADED": return {
					...state,
					templates: {
						...state.templates,
						[action.kind]: action.items
					}
				};
				case "TEMPLATE_ADDED": return {
					...state,
					templates: {
						...state.templates,
						[action.kind]: [action.template, ...state.templates[action.kind]]
					}
				};
				case "TEMPLATE_UPDATED": return {
					...state,
					templates: {
						...state.templates,
						[action.kind]: state.templates[action.kind].map((item) => item.id === action.template.id ? action.template : item)
					}
				};
				case "TEMPLATE_REMOVED": return {
					...state,
					templates: {
						...state.templates,
						[action.kind]: state.templates[action.kind].filter((item) => item.id !== action.id)
					}
				};
				case "COMBOS_LOADED": return {
					...state,
					combos: action.items
				};
				case "PRESETS_LOADED": return {
					...state,
					presets: action.items
				};
				case "TOOLS_LOADED": return {
					...state,
					tools: action.items
				};
				case "MODELS_LOADED": return {
					...state,
					models: action.items
				};
				case "OPEN_FLOW": {
					const workflows = state.workflows.some((flow) => flow.id === action.flow.id) ? state.workflows.map((flow) => flow.id === action.flow.id ? action.flow : flow) : [action.flow, ...state.workflows];
					return openDocument({
						...state,
						workflows
					}, flowToCanvas(action.flow), "workflow", action.flow.id);
				}
				case "OPEN_SERVICE": {
					const services = state.services.some((service) => service.id === action.service.id) ? state.services.map((service) => service.id === action.service.id ? action.service : service) : [action.service, ...state.services];
					return openDocument({
						...state,
						services
					}, serviceToCanvas(action.service), "service", action.service.id);
				}
				case "OPEN_FLOW_TEMPLATE": {
					const flowTemplates = state.flowTemplates.some((template) => template.id === action.template.id) ? state.flowTemplates.map((template) => template.id === action.template.id ? action.template : template) : [action.template, ...state.flowTemplates];
					return {
						...openDocument({
							...state,
							flowTemplates
						}, flowToCanvas(action.template), "flowTemplate", action.template.id),
						instanceOptions: {
							newSession: false,
							workspacePath: ""
						}
					};
				}
				case "CLEAR_CANVAS": return {
					...state,
					currentId: null,
					currentKind: null,
					canvas: {
						nodes: [],
						edges: []
					},
					selection: {
						nodeId: null,
						edgeId: null,
						lib: null
					},
					editor: null,
					dirty: false,
					run: {
						runId: null,
						sessionId: null,
						snapshot: null
					}
				};
				case "GRAPH_REPLACED": return {
					...state,
					canvas: {
						nodes: action.nodes,
						edges: action.edges
					},
					dirty: action.dirty
				};
				case "NODE_ADDED": return {
					...state,
					canvas: {
						...state.canvas,
						nodes: [...state.canvas.nodes, action.node]
					},
					dirty: true
				};
				case "NODE_MOVED": return {
					...state,
					canvas: {
						...state.canvas,
						nodes: state.canvas.nodes.map((node) => node.id === action.id ? {
							...node,
							position: action.position
						} : node)
					},
					dirty: true
				};
				case "NODE_REMOVED": {
					const removed = /* @__PURE__ */ new Set([action.id]);
					const main = state.canvas.nodes.find((node) => node.id === action.id);
					if (main && (main.kind === "parent" || main.kind === "agent")) {
						for (const node of state.canvas.nodes) if (node.kind === "proxy" && node.proxySourceId === action.id) removed.add(node.id);
					}
					return {
						...state,
						canvas: {
							nodes: state.canvas.nodes.filter((node) => !removed.has(node.id)),
							edges: state.canvas.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
						},
						dirty: true
					};
				}
				case "EDGE_ADDED": return {
					...state,
					canvas: {
						...state.canvas,
						edges: [...state.canvas.edges, action.edge]
					},
					dirty: true
				};
				case "EDGE_REMOVED": return {
					...state,
					canvas: {
						...state.canvas,
						edges: state.canvas.edges.filter((edge) => edge.id !== action.id)
					},
					dirty: true
				};
				case "SELECT_NODE": return {
					...state,
					selection: {
						nodeId: action.id,
						edgeId: null,
						lib: null
					},
					editor: {
						source: "node",
						id: action.id
					}
				};
				case "SELECT_EDGE": return {
					...state,
					selection: {
						nodeId: null,
						edgeId: action.id,
						lib: null
					},
					editor: {
						source: "edge",
						id: action.id
					}
				};
				case "SELECT_LIB": return {
					...state,
					selection: {
						nodeId: null,
						edgeId: null,
						lib: {
							kind: action.kind,
							id: action.id
						}
					}
				};
				case "SELECT_EDITOR": return {
					...state,
					editor: action.editor
				};
				case "CLEAR_SELECTION": return {
					...state,
					selection: {
						nodeId: null,
						edgeId: null,
						lib: null
					},
					editor: null
				};
				case "NODE_DATA_PATCH": return {
					...state,
					canvas: {
						...state.canvas,
						nodes: state.canvas.nodes.map((node) => node.id === action.id ? {
							...node,
							data: {
								...node.data,
								...action.patch
							}
						} : node)
					},
					dirty: true
				};
				case "EDGE_PATCH": return {
					...state,
					canvas: {
						...state.canvas,
						edges: state.canvas.edges.map((edge) => edge.id === action.id ? {
							...edge,
							...action.patch
						} : edge)
					},
					dirty: true
				};
				case "DOC_PATCH": return state.currentKind === "workflow" ? {
					...state,
					workflows: state.workflows.map((flow) => flow.id === state.currentId ? {
						...flow,
						...action.patch.name !== void 0 ? { name: action.patch.name } : {},
						...action.patch.description !== void 0 ? { description: action.patch.description } : {}
					} : flow),
					dirty: true
				} : state.currentKind === "flowTemplate" ? {
					...state,
					flowTemplates: state.flowTemplates.map((template) => template.id === state.currentId ? {
						...template,
						...action.patch.name !== void 0 ? { name: action.patch.name } : {},
						...action.patch.description !== void 0 ? { description: action.patch.description } : {}
					} : template),
					dirty: true
				} : state.currentKind === "service" ? {
					...state,
					services: state.services.map((service) => service.id === state.currentId ? {
						...service,
						...action.patch.name !== void 0 ? { name: action.patch.name } : {},
						...action.patch.description !== void 0 ? { description: action.patch.description } : {}
					} : service),
					dirty: true
				} : state;
				case "SET_DIRTY": return {
					...state,
					dirty: action.dirty
				};
				case "MARK_SAVED": return {
					...state,
					dirty: false,
					savedGraph: graphSnapshotOf(state)
				};
				case "RUN_STARTED": return {
					...state,
					run: {
						runId: action.runId,
						sessionId: action.runSessionId ?? null,
						snapshot: null
					}
				};
				case "RUN_SNAPSHOT": return {
					...state,
					run: {
						...state.run,
						snapshot: action.snapshot
					}
				};
				case "RUN_CLEARED": return {
					...state,
					run: {
						runId: null,
						sessionId: null,
						snapshot: null
					}
				};
				case "TOAST_PUSH": return {
					...state,
					toasts: [...state.toasts, action.toast]
				};
				case "TOAST_DROP": return {
					...state,
					toasts: state.toasts.filter((toast) => toast.id !== action.id)
				};
				case "SET_MESSAGE": return {
					...state,
					message: action.message
				};
				case "HISTORY_PUSH": {
					const past = [...state.history.past, action.snapshot];
					if (past.length > 60) past.shift();
					return {
						...state,
						history: {
							past,
							future: []
						}
					};
				}
				case "UNDO": {
					const previous = state.history.past.at(-1);
					if (!previous) return state;
					const next = {
						...state,
						canvas: {
							nodes: previous.nodes,
							edges: previous.edges
						},
						history: {
							past: state.history.past.slice(0, -1),
							future: [...state.history.future, graphSnapshotOf(state)]
						}
					};
					return {
						...next,
						...sanitizeSelectionAfterCanvas(next),
						dirty: !graphSnapshotsEqual(next.canvas, state.savedGraph)
					};
				}
				case "REDO": {
					const next = state.history.future.at(-1);
					if (!next) return state;
					const applied = {
						...state,
						canvas: {
							nodes: next.nodes,
							edges: next.edges
						},
						history: {
							past: [...state.history.past, graphSnapshotOf(state)],
							future: state.history.future.slice(0, -1)
						}
					};
					return {
						...applied,
						...sanitizeSelectionAfterCanvas(applied),
						dirty: !graphSnapshotsEqual(applied.canvas, state.savedGraph)
					};
				}
				case "PANELS_SET": return {
					...state,
					panels: {
						...state.panels,
						...action.panels
					}
				};
				case "CONFIRM_SET": return {
					...state,
					confirm: action.confirm
				};
				case "HISTORY_OPEN": return {
					...state,
					historyOpen: action.open
				};
				case "RUN_HISTORY_LOADED": return {
					...state,
					runHistory: action.items,
					selectedRunId: action.items[0]?.id ?? state.selectedRunId
				};
				case "RUN_HISTORY_SELECT": return {
					...state,
					selectedRunId: action.id
				};
				case "COMBO_OPEN": return {
					...state,
					comboOpen: action.open
				};
				case "SCHEDULER_OPEN": return {
					...state,
					schedulerOpen: action.open
				};
				default: return state;
			}
		}
		/**
		* 画布变化后的选中/编辑器校验（Bug 8）：UNDO/REDO 恢复画布后，selection 与
		* editor 可能仍指向已不存在的节点/连线（如 REDO 一个删除操作后选中残留），
		* 返回清理后的 selection/editor —— 引用失效的项置空，避免键盘删除误删与
		* Inspector 渲染空数据。
		*/
		function sanitizeSelectionAfterCanvas(state) {
			const nodeExists = (id) => id != null && state.canvas.nodes.some((node) => node.id === id);
			const edgeExists = (id) => id != null && state.canvas.edges.some((edge) => edge.id === id);
			const selection = {
				nodeId: nodeExists(state.selection.nodeId) ? state.selection.nodeId : null,
				edgeId: edgeExists(state.selection.edgeId) ? state.selection.edgeId : null,
				lib: state.selection.lib
			};
			let editor = state.editor;
			if (editor) {
				if (editor.source === "node" && !nodeExists(editor.id)) editor = null;
				else if (editor.source === "edge" && !edgeExists(editor.id)) editor = null;
			}
			return {
				selection,
				editor
			};
		}
		//#endregion
		//#region src/client/studio/studio-selectors.ts
		/** 当前工作流文档（内存列表优先；草稿回退）。 */
		function currentFlowOf(state) {
			if (state.currentKind !== "workflow" || !state.currentId) return null;
			return state.workflows.find((flow) => flow.id === state.currentId) ?? null;
		}
		/** 当前工作流模板文档（模板态画布）。 */
		function currentFlowTemplateOf(state) {
			if (state.currentKind !== "flowTemplate" || !state.currentId) return null;
			return state.flowTemplates.find((template) => template.id === state.currentId) ?? null;
		}
		/** 当前服务文档。 */
		function currentServiceOf(state) {
			if (state.currentKind !== "service" || !state.currentId) return null;
			return state.services.find((service) => service.id === state.currentId) ?? null;
		}
		/** 当前运行状态（running 判定）。 */
		function isRunningOf(state) {
			return state.run.snapshot?.status === "running" || state.run.runId !== null && state.run.snapshot === null;
		}
		/** 编辑器数据（右侧面板渲染源）。 */
		function editorDataOf(state) {
			const editor = state.editor;
			if (!editor) return null;
			if (editor.source === "workflow") {
				const flow = state.workflows.find((item) => item.id === editor.id);
				return flow ? {
					kind: "workflow",
					data: {
						name: flow.name,
						description: flow.description
					},
					name: flow.name
				} : null;
			}
			if (editor.source === "flowTemplate") {
				const template = state.flowTemplates.find((item) => item.id === editor.id);
				return template ? {
					kind: "workflow",
					data: {
						name: template.name,
						description: template.description
					},
					name: template.name,
					template: true,
					templateId: template.id
				} : null;
			}
			if (editor.source === "service") {
				const service = state.services.find((item) => item.id === editor.id);
				return service ? {
					kind: "service",
					data: {
						name: service.name,
						description: service.description
					},
					name: service.name
				} : null;
			}
			if (editor.source === "template") {
				const template = state.templates[editor.kind].find((item) => item.id === editor.id);
				if (!template) return null;
				const kind0 = editor.kind;
				return {
					kind: kind0,
					data: template,
					name: String(template.name ?? ""),
					templateId: template.id,
					template: true,
					isParent: kind0 === "role" && template.kind === "parent"
				};
			}
			if (editor.source === "node") {
				const node = state.canvas.nodes.find((item) => item.id === editor.id);
				if (!node) return null;
				const data = node.data;
				if (node.kind === "parent" || node.kind === "agent") return {
					kind: "role",
					data,
					name: String(data.label ?? ""),
					nodeId: node.id,
					isParent: node.kind === "parent"
				};
				if (node.kind === "file") return {
					kind: "file",
					data,
					name: String(data.label ?? ""),
					nodeId: node.id
				};
				if (node.kind === "database") return {
					kind: "database",
					data,
					name: String(data.label ?? ""),
					nodeId: node.id
				};
				if (node.kind === "group") {
					const members = [...new Set(data.memberIds ?? [])].map((memberId) => {
						const member = state.canvas.nodes.find((item) => item.id === memberId);
						return {
							id: memberId,
							label: String((member?.data)?.label ?? memberId)
						};
					});
					return {
						kind: "group",
						data,
						name: String(data.label ?? ""),
						nodeId: node.id,
						members
					};
				}
				if (node.kind === "start" || node.kind === "end" || node.kind === "pause") return {
					kind: "stage",
					data,
					name: String(data.label ?? ""),
					nodeId: node.id
				};
				if (node.kind === "proxy") {
					const sourceId = String(node.proxySourceId ?? "");
					const main = state.canvas.nodes.find((item) => item.id === sourceId);
					return {
						kind: "proxy",
						data,
						name: "",
						nodeId: node.id,
						mainLabel: String((main?.data)?.label ?? "")
					};
				}
				return {
					kind: "role",
					data,
					name: String(data.label ?? ""),
					nodeId: node.id
				};
			}
			if (editor.source === "edge") {
				const edge = state.canvas.edges.find((item) => item.id === editor.id);
				return edge ? {
					kind: "edge",
					data: edge,
					name: ""
				} : null;
			}
			return null;
		}
		/** 折叠/切换下一步循环位置（左展→切换底栏→收起底栏→左展）。 */
		function nextPanelMode(mode) {
			return (mode + 1) % 3;
		}
		/** 左栏是否展开（循环位置 0）。 */
		function leftPanelOpenOf(state) {
			return state.panels.mode === 0;
		}
		/** 底栏是否展开（循环位置 1）。 */
		function bottomPanelOpenOf(state) {
			return state.panels.mode === 1;
		}
		/** 是否处于「全隐」态（循环位置 2：收起底栏/左栏，仅画布）。 */
		function panelsFullyCollapsedOf(state) {
			return state.panels.mode === 2;
		}
		/**
		* 右侧属性栏是否显示：默认隐藏（折叠），仅当选中「具备属性」的对象时才展开。
		* 判定 = 编辑对象存在且其属性栏类型不是「阶段」（阶段节点/侧栏阶段卡片不具备属性，不弹）；
		* 其余（实例/工作流/服务/模板/角色/文件/数据库/协作组/连线/画布角色节点含父代理节点/虚拟节点）都弹。
		* 注意：父代理模板也具备属性（属性栏显示模板内容），此处一并弹出。
		*/
		function inspectorOpenOf(state) {
			const data = editorDataOf(state);
			return data != null && data.kind !== "stage";
		}
		//#endregion
		//#region src/client/studio/instance-options.ts
		/** instanceOptions 持久化键。 */
		const INSTANCE_OPTIONS_KEY = "visual-workflow:instance-options";
		/** 默认实例选项（与 createInitialState 一致）。 */
		function defaultInstanceOptions() {
			return {
				newSession: false,
				workspacePath: ""
			};
		}
		/** 读取缓存（缺失/损坏回退默认值；隐私模式等异常静默）。 */
		function restoreInstanceOptions(storage) {
			try {
				const raw = storage.getItem(INSTANCE_OPTIONS_KEY);
				if (!raw) return defaultInstanceOptions();
				const parsed = JSON.parse(raw);
				return {
					newSession: parsed.newSession === true,
					workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : ""
				};
			} catch {
				return defaultInstanceOptions();
			}
		}
		/** 写入缓存（newSession 布尔化、workspacePath 字符串化后落盘）。 */
		function keepInstanceOptions(storage, options) {
			try {
				storage.setItem(INSTANCE_OPTIONS_KEY, JSON.stringify({
					newSession: options.newSession === true,
					workspacePath: typeof options.workspacePath === "string" ? options.workspacePath : ""
				}));
			} catch {}
		}
		//#endregion
		//#region src/client/hooks/useStudioState.ts
		/** 初始状态工厂：默认状态 + 恢复 instanceOptions 缓存（浏览器守卫；异常回退默认）。 */
		function createInitialStateWithOptions(sessionId) {
			const initial = createInitialState(sessionId);
			if (typeof window === "undefined") return initial;
			return {
				...initial,
				instanceOptions: restoreInstanceOptions(window.localStorage)
			};
		}
		/** 主状态机（会话绑定：初始 sessionId 注入，后续由 SET_SESSION 更新）。 */
		function useStudioState(sessionId) {
			const [state, dispatch] = (0, react.useReducer)(studioReducer, sessionId, createInitialStateWithOptions);
			return {
				state,
				dispatch
			};
		}
		//#endregion
		//#region src/host/shared/protocol.ts
		/** 工作流列表端点名。 */
		const EP_LIST_WORKFLOWS = "listWorkflows";
		/** 获取单个工作流。 */
		const EP_GET_WORKFLOW = "getWorkflow";
		/** 保存工作流（含创建工作流。按 §4.6 清单逐字列出）。 */
		const EP_PUT_WORKFLOW = "putWorkflow";
		/** 删除工作流。 */
		const EP_DELETE_WORKFLOW = "deleteWorkflow";
		/** 服务列表端点名。 */
		const EP_LIST_SERVICES = "listServices";
		/** 获取单个服务。 */
		const EP_GET_SERVICE = "getService";
		/** 保存服务。 */
		const EP_PUT_SERVICE = "putService";
		/** 删除服务。 */
		const EP_DELETE_SERVICE = "deleteService";
		/** 启动服务（模式二 fork 子进程）。 */
		const EP_SERVICE_START = "serviceStart";
		/** 停止服务。 */
		const EP_SERVICE_STOP = "serviceStop";
		/**
		* 服务调试流式端点名（服务控制台调试框：代理运行中服务的 /v1/chat/completions，
		* SSE 逐块转发回浏览器打字机渲染）。
		* 为什么走 Host 代理而非浏览器直连：服务进程无 CORS 头，同源代理避免跨域失败；
		* apiKey 鉴权由 Host 侧配置持有，不落浏览器。
		*/
		const EP_SERVICE_DEBUG = "serviceDebug";
		/**
		* 创建会话端点名（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
		* 实例绑定该新会话 id——官方 agents.create 不传 parentSession 即无父根会话）。
		* 参数 { sessionId?, workspacePath?, label? }，返回 { sessionId }。
		*/
		const EP_CREATE_SESSION = "createSession";
		/** 模板列表端点名（角色/文件/数据库三类共用）。 */
		const EP_LIST_TEMPLATES = "listTemplates";
		/** 保存模板。 */
		const EP_PUT_TEMPLATE = "putTemplate";
		/** 删除模板。 */
		const EP_DELETE_TEMPLATE = "deleteTemplate";
		/** 工作流模板列表端点名（图2 交互改造：工作流模板全局共享，跨会话可见）。 */
		const EP_LIST_FLOW_TEMPLATES = "listFlowTemplates";
		/** 保存工作流模板（新建/更新统一；模板全局共享，不按会话隔离）。 */
		const EP_PUT_FLOW_TEMPLATE = "putFlowTemplate";
		/** 删除工作流模板。 */
		const EP_DELETE_FLOW_TEMPLATE = "deleteFlowTemplate";
		/** 受管文件上传端点名（非文本文件：base64 内容 → data/files/ 受管拷贝，§4.2.4.1 规则 2）。 */
		const EP_FILE_UPLOAD = "fileUpload";
		/** 官方预设列表端点名。 */
		const EP_PRESETS = "presets";
		/** 工具目录列表端点名（组合管理工具勾选清单用）。 */
		const EP_TOOLS = "tools";
		/** 模型列表端点名（思考强度列表来自适配器公布的 reasoning efforts）。 */
		const EP_MODELS = "models";
		/** 工具组合列表端点名。 */
		const EP_TOOL_COMBOS = "toolCombos";
		/** 保存工具组合。 */
		const EP_TOOL_COMBO_PUT = "toolComboPut";
		/** 删除工具组合。 */
		const EP_TOOL_COMBO_DELETE = "toolComboDelete";
		/** 插件目录列表端点名（组合管理用）。 */
		const EP_PLUGIN_CATALOG = "pluginCatalog";
		/** 保存 MCP 服务器。 */
		const EP_MCP_PUT = "mcpPut";
		/** 删除 MCP 服务器。 */
		const EP_MCP_DELETE = "mcpDelete";
		/** 切换 MCP 服务器启用状态。 */
		const EP_MCP_TOGGLE = "mcpToggle";
		/** 设置单个工具开/关状态端点名（全局即时生效）。 */
		const EP_TOOL_SWITCH_PUT = "toolSwitchPut";
		/** 批量设置一组工具开/关状态端点名（组合管理「标签一键开关」用；全局即时生效）。 */
		const EP_TOOL_SWITCH_PUT_MANY = "toolSwitchPutMany";
		/** 运行状态轮询端点名。 */
		const EP_RUN_STATUS = "runStatus";
		/** 会话活跃 run 列表端点名（工作台进入时自动选中运行中实例用；running/paused 保留锁）。 */
		const EP_ACTIVE_RUNS = "activeRuns";
		/** 运行停止端点名。 */
		const EP_RUN_STOP = "runStop";
		/** 运行历史端点名。 */
		const EP_RUN_HISTORY = "runHistory";
		/** 断点续跑端点名。 */
		const EP_RUN_RESUME = "runResume";
		/** 数据库连接测试端点名。 */
		const EP_DB_TEST = "dbTest";
		/** 导出工作流端点名（v2 bundle）。 */
		const EP_EXPORT_WORKFLOW = "exportWorkflow";
		/** 导入工作流端点名（v2 bundle）。 */
		const EP_IMPORT_WORKFLOW = "importWorkflow";
		/** 导出角色模板端点名（v2 bundle）。 */
		const EP_EXPORT_AGENT_TEMPLATE = "exportAgentTemplate";
		/** 导入角色模板端点名（v2 bundle）。 */
		const EP_IMPORT_AGENT_TEMPLATE = "importAgentTemplate";
		/** 定时任务列表端点名（含运行态合并视图）。 */
		const EP_SCHEDULER_TASKS = "schedulerTasks";
		/** 保存定时任务端点名（新建/更新统一）。 */
		const EP_SCHEDULER_TASK_PUT = "schedulerTaskPut";
		/** 删除定时任务端点名。 */
		const EP_SCHEDULER_TASK_DELETE = "schedulerTaskDelete";
		//#endregion
		//#region src/client/lib/remote.ts
		/** 调用 Host API（同源 fetch）。 */
		async function remoteCall(endpoint, args = {}) {
			let response;
			try {
				response = await fetch(`/visual-workflow/${endpoint}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ args })
				});
			} catch (error) {
				throw new Error(`无法连接工作流服务：${error instanceof Error ? error.message : String(error)}`);
			}
			let payload = {};
			try {
				payload = await response.json();
			} catch {}
			if (!response.ok || payload.ok === false) {
				const error = new Error(String(payload?.error?.message ?? `工作流服务错误（HTTP ${response.status}）`));
				const code = (payload?.error)?.code;
				if (typeof code === "string" && code) error.code = code;
				throw error;
			}
			return payload.value;
		}
		/**
		* 流式调用 Host API（SSE 透传）：POST /visual-workflow/<endpoint>，把服务端
		* SSE 的 data 行文本逐行回调（解析归调用方）；流结束 resolve。
		* 非 2xx（未写流头）抛出后端 message；AbortError 静默返回（调用方主动停止）。
		*/
		async function streamCall(endpoint, args, onLine, signal) {
			let response;
			try {
				response = await fetch(`/visual-workflow/${endpoint}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ args }),
					signal
				});
			} catch (error) {
				if (error?.name === "AbortError") return;
				throw new Error(`无法连接工作流服务：${error instanceof Error ? error.message : String(error)}`);
			}
			if (!response.ok) {
				let message = `工作流服务错误（HTTP ${response.status}）`;
				let code;
				try {
					const payload = await response.json();
					if (payload?.error?.message) message = String(payload.error.message);
					const rawCode = payload?.error?.code;
					if (typeof rawCode === "string" && rawCode) code = rawCode;
				} catch {}
				const error = new Error(message);
				if (code) error.code = code;
				throw error;
			}
			if (!response.body) throw new Error("流式响应无内容");
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let index;
					while ((index = buffer.indexOf("\n")) >= 0) {
						const line = buffer.slice(0, index).replace(/\r$/, "");
						buffer = buffer.slice(index + 1);
						if (line.trim()) onLine(line);
					}
				}
				if (buffer.trim()) onLine(buffer.replace(/\r$/, ""));
			} catch (error) {
				if (error?.name === "AbortError") return;
				throw error;
			}
		}
		//#endregion
		//#region src/client/hooks/useRemote.ts
		/** 远端调用面（remoteCall 为纯函数，hook 仅提供稳定引用）。 */
		function useRemote() {
			return (0, react.useMemo)(() => ({ call: remoteCall }), []);
		}
		//#endregion
		//#region src/client/hooks/useToast.ts
		/** 轻提示展示时长。 */
		const TOAST_DURATION_MS = 2600;
		/** 轻提示面（dispatch TOAST_PUSH/DROP；超时自动移除）。 */
		function useToast(dispatch) {
			const toast = (0, react.useCallback)((kind, text) => {
				const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
				dispatch({
					type: "TOAST_PUSH",
					toast: {
						id,
						kind,
						text
					}
				});
				setTimeout(() => dispatch({
					type: "TOAST_DROP",
					id
				}), TOAST_DURATION_MS);
			}, [dispatch]);
			return {
				toast,
				toastError: (0, react.useCallback)((error) => {
					toast("error", error instanceof Error ? error.message : String(error));
				}, [toast])
			};
		}
		//#endregion
		//#region src/client/hooks/useWorkflows.ts
		/** 画布 → 文档序列化（节点/连线直接映射；P12 图模型接管完整归一化）。 */
		function serializeWorkflow(flow, nodes, edges) {
			return {
				...flow,
				nodes: nodes.map((node) => ({
					id: node.id,
					kind: node.kind,
					position: node.position,
					data: node.data,
					...node.proxySourceId !== void 0 ? { proxySourceId: node.proxySourceId } : {}
				})),
				lines: edges.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					sourceHandle: edge.sourceHandle,
					targetHandle: edge.targetHandle,
					...edge.condition ? { condition: edge.condition } : {}
				}))
			};
		}
		/** 工作流列表面（远端失败抛错，由调用方 toast）。 */
		function useWorkflows(dispatch, remote) {
			/** 加载全部会话的实例列表（工作台全局化：不按当前会话过滤）。 */
			const loadWorkflows = (0, react.useCallback)(async () => {
				const items = await remote.call(EP_LIST_WORKFLOWS, {});
				const list = Array.isArray(items) ? items : [];
				dispatch({
					type: "WORKFLOWS_LOADED",
					items: list
				});
				return list;
			}, [dispatch, remote]);
			const createWorkflowDraft = (0, react.useCallback)((name, sessionId) => {
				const now = (/* @__PURE__ */ new Date()).toISOString();
				const draft = {
					id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
					sessionId,
					mode: "mode1",
					name,
					description: "",
					revision: 0,
					nodes: [],
					lines: [],
					createdAt: now,
					_draft: true
				};
				dispatch({
					type: "WORKFLOW_ADDED",
					flow: draft
				});
				return draft;
			}, [dispatch]);
			/**
			* 模板 → 实例：深拷贝模板（节点/连线全量内联，与模板完全断引用——§4.2.1 解耦语义）。
			* 目标会话由调用方决定（当前主会话 / 新建主会话）；不继承 startNewSession/workspacePath
			* （一次性临时选项，字段已退役）。
			*/
			const instantiateFromTemplate = (0, react.useCallback)((template, targetSessionId) => {
				const now = (/* @__PURE__ */ new Date()).toISOString();
				const draft = {
					id: `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
					sessionId: targetSessionId,
					mode: template.mode,
					name: template.name ?? "未命名工作流",
					description: template.description ?? "",
					revision: 0,
					nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
					lines: JSON.parse(JSON.stringify(template.lines ?? [])),
					createdAt: now,
					_draft: true
				};
				dispatch({
					type: "WORKFLOW_ADDED",
					flow: draft
				});
				return draft;
			}, [dispatch]);
			/** 在途保存 Promise（快速双击/重复触发时共享同一请求，避免第二次携带旧 revision 触发 409）。 */
			const saveInflight = (0, react.useRef)(null);
			return {
				loadWorkflows,
				createWorkflowDraft,
				instantiateFromTemplate,
				saveWorkflow: (0, react.useCallback)(async (flow, nodes, edges) => {
					if (saveInflight.current?.flowId === flow.id) return saveInflight.current.promise;
					const task = (async () => {
						const serialized = serializeWorkflow(flow, nodes, edges);
						const saved = await remote.call(EP_PUT_WORKFLOW, {
							sessionId: flow.sessionId,
							flow: serialized
						});
						dispatch({
							type: "WORKFLOW_UPDATED",
							flow: saved
						});
						return saved;
					})();
					const entry = {
						flowId: flow.id,
						promise: task
					};
					saveInflight.current = entry;
					try {
						return await task;
					} finally {
						if (saveInflight.current === entry) saveInflight.current = null;
					}
				}, [dispatch, remote]),
				deleteWorkflow: (0, react.useCallback)(async (flow) => {
					await remote.call(EP_DELETE_WORKFLOW, {
						sessionId: flow.sessionId,
						id: flow.id
					});
					dispatch({
						type: "WORKFLOW_REMOVED",
						id: flow.id
					});
				}, [dispatch, remote]),
				openFlow: (0, react.useCallback)((flow) => {
					dispatch({
						type: "OPEN_FLOW",
						flow
					});
				}, [dispatch])
			};
		}
		//#endregion
		//#region src/client/hooks/useFlowTemplates.ts
		/** 画布 → 模板序列化（与 serializeWorkflow 同构）。 */
		function serializeFlowTemplate(template, nodes, edges) {
			return {
				...template,
				nodes: nodes.map((node) => ({
					id: node.id,
					kind: node.kind,
					position: node.position,
					data: node.data,
					...node.proxySourceId !== void 0 ? { proxySourceId: node.proxySourceId } : {}
				})),
				lines: edges.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					sourceHandle: edge.sourceHandle,
					targetHandle: edge.targetHandle,
					...edge.condition ? { condition: edge.condition } : {}
				}))
			};
		}
		/** 工作流模板列表面（远端失败抛错，由调用方 toast）。 */
		function useFlowTemplates(dispatch, remote) {
			return {
				loadFlowTemplates: (0, react.useCallback)(async () => {
					const items = await remote.call(EP_LIST_FLOW_TEMPLATES);
					dispatch({
						type: "FLOW_TEMPLATES_LOADED",
						items: Array.isArray(items) ? items : []
					});
				}, [dispatch, remote]),
				createFlowTemplateDraft: (0, react.useCallback)((mode) => {
					const now = (/* @__PURE__ */ new Date()).toISOString();
					const draft = {
						id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
						mode,
						name: mode === "mode1" ? "未命名工作流模板" : "未命名服务模板",
						description: "",
						revision: 0,
						nodes: [],
						lines: [],
						createdAt: now,
						_draft: true
					};
					dispatch({
						type: "FLOW_TEMPLATE_ADDED",
						template: draft
					});
					return draft;
				}, [dispatch]),
				saveFlowTemplate: (0, react.useCallback)(async (template, nodes, edges) => {
					const serialized = serializeFlowTemplate(template, nodes, edges);
					const saved = await remote.call(EP_PUT_FLOW_TEMPLATE, { template: serialized });
					dispatch({
						type: "FLOW_TEMPLATE_UPDATED",
						template: saved
					});
					return saved;
				}, [dispatch, remote]),
				deleteFlowTemplate: (0, react.useCallback)(async (id) => {
					await remote.call(EP_DELETE_FLOW_TEMPLATE, { id });
					dispatch({
						type: "FLOW_TEMPLATE_REMOVED",
						id
					});
				}, [dispatch, remote]),
				openFlowTemplate: (0, react.useCallback)((template) => {
					dispatch({
						type: "OPEN_FLOW_TEMPLATE",
						template
					});
				}, [dispatch])
			};
		}
		//#endregion
		//#region src/client/hooks/useTemplates.ts
		function draftOf(kind) {
			const now = (/* @__PURE__ */ new Date()).toISOString();
			const id = `${kind === "role" ? "role" : kind === "file" ? "file" : kind === "group" ? "group" : "db"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			if (kind === "role") return {
				id,
				kind: "agent",
				name: "新角色模板",
				systemPrompt: "",
				provider: "",
				model: "",
				presetId: null,
				retryLimit: 3,
				reactLimit: null,
				inputSchema: "",
				outputSchema: "",
				injectSystemPrompt: true,
				injectToolSections: true,
				promptFilePath: void 0,
				createdAt: now,
				updatedAt: now,
				_draft: true
			};
			if (kind === "file") return {
				id,
				kind: "file",
				name: "新文件模板",
				fileKind: "text",
				content: "",
				createdAt: now,
				updatedAt: now,
				_draft: true
			};
			if (kind === "group") return {
				id,
				name: "新协作组模板",
				collabPrompt: "",
				createdAt: now,
				updatedAt: now,
				_draft: true
			};
			return {
				id,
				kind: "database",
				name: "新数据库模板",
				description: "",
				dbType: "local",
				dbKind: "sqlite",
				vectorSource: "embedding",
				createdAt: now,
				updatedAt: now,
				_draft: true
			};
		}
		/** 模板列表面（远端失败抛错，由调用方 toast）。 */
		function useTemplates(dispatch, remote) {
			return {
				loadTemplates: (0, react.useCallback)(async () => {
					const results = await Promise.allSettled([
						"role",
						"file",
						"database",
						"group"
					].map(async (kind) => {
						const items = await remote.call(EP_LIST_TEMPLATES, { kind });
						return {
							kind,
							items: Array.isArray(items) ? items : []
						};
					}));
					const aggregated = {
						role: [],
						file: [],
						database: [],
						group: []
					};
					for (const result of results) {
						if (result.status !== "fulfilled") continue;
						const { kind, items } = result.value;
						aggregated[kind] = items;
						dispatch({
							type: "TEMPLATES_LOADED",
							kind,
							items
						});
					}
					return aggregated;
				}, [dispatch, remote]),
				createTemplateDraft: (0, react.useCallback)((kind) => {
					const template = draftOf(kind);
					dispatch({
						type: "TEMPLATE_ADDED",
						kind,
						template
					});
					return template;
				}, [dispatch]),
				saveTemplate: (0, react.useCallback)(async (kind, template) => {
					dispatch({
						type: "TEMPLATE_UPDATED",
						kind,
						template: await remote.call(EP_PUT_TEMPLATE, {
							kind,
							template
						})
					});
				}, [dispatch, remote]),
				deleteTemplate: (0, react.useCallback)(async (kind, id) => {
					await remote.call(EP_DELETE_TEMPLATE, {
						kind,
						id
					});
					dispatch({
						type: "TEMPLATE_REMOVED",
						kind,
						id
					});
				}, [dispatch, remote])
			};
		}
		//#endregion
		//#region src/client/hooks/useSelection.ts
		/** 选中与编辑器面（dispatch 直通）。 */
		function useSelection(dispatch) {
			return {
				selectNode: (0, react.useCallback)((id) => dispatch({
					type: "SELECT_NODE",
					id
				}), [dispatch]),
				selectEdge: (0, react.useCallback)((id) => dispatch({
					type: "SELECT_EDGE",
					id
				}), [dispatch]),
				selectLib: (0, react.useCallback)((kind, id) => dispatch({
					type: "SELECT_LIB",
					kind,
					id
				}), [dispatch]),
				selectEditor: (0, react.useCallback)((editor) => dispatch({
					type: "SELECT_EDITOR",
					editor
				}), [dispatch]),
				clearSelection: (0, react.useCallback)(() => dispatch({ type: "CLEAR_SELECTION" }), [dispatch])
			};
		}
		//#endregion
		//#region src/client/hooks/useGraphHistory.ts
		/** 图历史面（remember 需在变更 dispatch 前调用）。 */
		function useGraphHistory(state, dispatch) {
			return {
				remember: (0, react.useCallback)(() => {
					dispatch({
						type: "HISTORY_PUSH",
						snapshot: graphSnapshotOf(state)
					});
				}, [dispatch, state]),
				undo: (0, react.useCallback)(() => dispatch({ type: "UNDO" }), [dispatch]),
				redo: (0, react.useCallback)(() => dispatch({ type: "REDO" }), [dispatch]),
				canUndo: state.history.past.length > 0,
				canRedo: state.history.future.length > 0
			};
		}
		//#endregion
		//#region src/client/hooks/useUnsavedGuard.ts
		/** 未保存守卫面（confirm 状态在 state 内）。 */
		function useUnsavedGuard(state, dispatch) {
			const guard = (0, react.useCallback)((proceed) => {
				if (!state.dirty) {
					proceed();
					return;
				}
				dispatch({
					type: "CONFIRM_SET",
					confirm: {
						kind: "unsaved",
						proceed
					}
				});
			}, [dispatch, state.dirty]);
			const saveAndProceed = (0, react.useCallback)(async (save) => {
				const pending = state.confirm;
				dispatch({
					type: "CONFIRM_SET",
					confirm: null
				});
				if (pending?.kind !== "unsaved") return;
				try {
					const saved = await save();
					if (saved !== null && saved !== void 0) pending.proceed?.();
				} catch {}
			}, [dispatch, state.confirm]);
			const discardAndProceed = (0, react.useCallback)(() => {
				const pending = state.confirm;
				dispatch({
					type: "CONFIRM_SET",
					confirm: null
				});
				if (pending?.kind === "unsaved") pending.proceed?.();
			}, [dispatch, state.confirm]);
			const cancel = (0, react.useCallback)(() => {
				dispatch({
					type: "CONFIRM_SET",
					confirm: null
				});
			}, [dispatch]);
			return {
				confirm: state.confirm,
				guard,
				saveAndProceed,
				discardAndProceed,
				cancel
			};
		}
		//#endregion
		//#region src/client/hooks/useRunControl.ts
		/** 运行控制面（远端失败抛错，由调用方 toast）。 */
		function useRunControl(dispatch, remote) {
			return {
				startRun: (0, react.useCallback)(async (sessionId, flowId) => {
					const result = await remote.call("run", {
						sessionId,
						flowId
					});
					const runId = String(result?.runId ?? "");
					if (runId) dispatch({
						type: "RUN_STARTED",
						runId,
						...result?.sessionId ? { runSessionId: String(result.sessionId) } : {}
					});
					return runId || null;
				}, [dispatch, remote]),
				stopRun: (0, react.useCallback)(async (sessionId, runId) => {
					await remote.call(EP_RUN_STOP, {
						sessionId,
						runId
					});
					dispatch({ type: "RUN_CLEARED" });
				}, [dispatch, remote])
			};
		}
		/** 终态集合（轮询停止判定）。 */
		const TERMINAL = /* @__PURE__ */ new Set([
			"completed",
			"failed",
			"stopped",
			"paused",
			"interrupted"
		]);
		/** 运行轮询 effect：runId 变化起轮询；终态停。 */
		function useRunPolling(sessionId, runId, dispatch, remote) {
			(0, react.useEffect)(() => {
				if (!runId) return void 0;
				let cancelled = false;
				const poll = async () => {
					try {
						const snapshot = await remote.call(EP_RUN_STATUS, {
							sessionId,
							runId
						});
						if (cancelled || !snapshot) return;
						dispatch({
							type: "RUN_SNAPSHOT",
							snapshot
						});
						if (TERMINAL.has(snapshot.status)) dispatch({ type: "RUN_CLEARED" });
					} catch {}
				};
				poll();
				const timer = setInterval(() => {
					poll();
				}, 600);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [
				dispatch,
				remote,
				runId,
				sessionId
			]);
		}
		//#endregion
		//#region src/client/hooks/useActiveRunsPolling.ts
		/** 全量活跃 run 轮询间隔（列表徽标为概要信息，2s 足够；当前实例快照仍走 600ms 快轮询）。 */
		const ACTIVE_RUNS_POLL_MS = 2e3;
		/** 全量活跃 run 轮询 effect：挂载即拉一次，随后每 2s 刷新（卸载清理定时器）。 */
		function useActiveRunsPolling(dispatch, remote) {
			(0, react.useEffect)(() => {
				let cancelled = false;
				const poll = async () => {
					try {
						const items = await remote.call(EP_ACTIVE_RUNS, {});
						if (cancelled) return;
						dispatch({
							type: "ACTIVE_RUNS_LOADED",
							items: Array.isArray(items) ? items : []
						});
					} catch {}
				};
				poll();
				const timer = setInterval(() => {
					poll();
				}, ACTIVE_RUNS_POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [dispatch, remote]);
		}
		//#endregion
		//#region src/client/hooks/useFlowFileSync.ts
		/** 文件→画布同步轮询间隔（与 runStatus 轮询频率错开；2s 足够发现外部修改）。 */
		const FLOW_FILE_SYNC_MS = 2e3;
		/** 最近已同步的外部 revision（防止同一次外部修改重复提示）。 */
		function useFlowFileSync(state, dispatch, remote, onExternalChange) {
			const appliedRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const kind = state.currentKind;
				if (kind !== "workflow" && kind !== "service") return void 0;
				const id = state.currentId;
				if (!id) return void 0;
				let cancelled = false;
				const poll = async () => {
					try {
						if (kind === "workflow") {
							const current = state.workflows.find((item) => item.id === id);
							if (!current) return;
							const doc = await remote.call(EP_GET_WORKFLOW, {
								sessionId: current.sessionId,
								id
							});
							if (cancelled || !doc) return;
							const remoteRevision = Number(doc.revision ?? 0);
							if (appliedRef.current?.kind === "workflow" && appliedRef.current.id === id && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return;
							if (remoteRevision <= Number(current.revision ?? 0)) return;
							if (state.dirty) {
								if (appliedRef.current?.revision !== remoteRevision) {
									appliedRef.current = {
										kind,
										id,
										revision: remoteRevision,
										updatedAt: doc.updatedAt ?? ""
									};
									onExternalChange?.("实例文件已被外部修改，请先保存或放弃当前修改后再刷新");
								}
								return;
							}
							appliedRef.current = {
								kind,
								id,
								revision: remoteRevision,
								updatedAt: doc.updatedAt ?? ""
							};
							dispatch({
								type: "OPEN_FLOW",
								flow: doc
							});
						} else {
							const current = state.services.find((item) => item.id === id);
							if (!current) return;
							const doc = await remote.call(EP_GET_SERVICE, {
								sessionId: current.sessionId,
								id
							});
							if (cancelled || !doc) return;
							const remoteRevision = Number(doc.revision ?? 0);
							if (appliedRef.current?.kind === "service" && appliedRef.current.id === id && appliedRef.current.revision === remoteRevision && appliedRef.current.updatedAt === doc.updatedAt) return;
							if (remoteRevision <= Number(current.revision ?? 0)) return;
							if (state.dirty) {
								if (appliedRef.current?.revision !== remoteRevision) {
									appliedRef.current = {
										kind,
										id,
										revision: remoteRevision,
										updatedAt: doc.updatedAt ?? ""
									};
									onExternalChange?.("服务文件已被外部修改，请先保存或放弃当前修改后再刷新");
								}
								return;
							}
							appliedRef.current = {
								kind,
								id,
								revision: remoteRevision,
								updatedAt: doc.updatedAt ?? ""
							};
							dispatch({
								type: "OPEN_SERVICE",
								service: doc
							});
						}
					} catch {}
				};
				poll();
				const timer = setInterval(() => {
					poll();
				}, FLOW_FILE_SYNC_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [
				dispatch,
				remote,
				state.currentKind,
				state.currentId,
				state.dirty,
				onExternalChange
			]);
		}
		//#endregion
		//#region src/client/hooks/useServiceControl.ts
		/** 服务控制面（远端失败抛错，由调用方 toast）。 */
		function useServiceControl(dispatch, remote) {
			return {
				loadServices: (0, react.useCallback)(async () => {
					const items = await remote.call(EP_LIST_SERVICES, {});
					const list = Array.isArray(items) ? items : [];
					dispatch({
						type: "SERVICES_LOADED",
						items: list
					});
					return list;
				}, [dispatch, remote]),
				createServiceDraft: (0, react.useCallback)((name, sessionId) => {
					const now = (/* @__PURE__ */ new Date()).toISOString();
					const draft = {
						id: `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						sessionId,
						name,
						description: "",
						revision: 0,
						nodes: [],
						lines: [],
						createdAt: now,
						updatedAt: now,
						status: "stopped",
						_draft: true
					};
					dispatch({
						type: "OPEN_SERVICE",
						service: draft
					});
					return draft;
				}, [dispatch]),
				instantiateFromTemplate: (0, react.useCallback)((template, targetSessionId) => {
					const now = (/* @__PURE__ */ new Date()).toISOString();
					const draft = {
						id: `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						sessionId: targetSessionId,
						name: template.name ?? "未命名服务",
						description: template.description ?? "",
						revision: 0,
						nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
						lines: JSON.parse(JSON.stringify(template.lines ?? [])),
						createdAt: now,
						updatedAt: now,
						status: "stopped",
						_draft: true
					};
					dispatch({
						type: "OPEN_SERVICE",
						service: draft
					});
					return draft;
				}, [dispatch]),
				saveService: (0, react.useCallback)(async (service, nodes, edges) => {
					const serialized = {
						...service,
						nodes: nodes.map((node) => ({
							id: node.id,
							kind: node.kind,
							position: node.position,
							data: node.data,
							...node.proxySourceId !== void 0 ? { proxySourceId: node.proxySourceId } : {}
						})),
						lines: edges.map((edge) => ({
							id: edge.id,
							source: edge.source,
							target: edge.target,
							sourceHandle: edge.sourceHandle,
							targetHandle: edge.targetHandle,
							...edge.condition ? { condition: edge.condition } : {}
						}))
					};
					const saved = await remote.call(EP_PUT_SERVICE, {
						sessionId: service.sessionId,
						service: serialized
					});
					dispatch({
						type: "SERVICE_UPDATED",
						service: saved
					});
					return saved;
				}, [dispatch, remote]),
				startService: (0, react.useCallback)(async (serviceId, sessionId) => {
					dispatch({
						type: "SERVICE_UPDATED",
						service: await remote.call(EP_SERVICE_START, {
							sessionId,
							serviceId
						})
					});
				}, [dispatch, remote]),
				stopService: (0, react.useCallback)(async (serviceId, sessionId) => {
					dispatch({
						type: "SERVICE_UPDATED",
						service: await remote.call(EP_SERVICE_STOP, {
							sessionId,
							serviceId
						})
					});
				}, [dispatch, remote])
			};
		}
		//#endregion
		//#region src/client/hooks/useModeSwitch.ts
		/** 模式切换面（dispatch SET_MODE）。 */
		function useModeSwitch(dispatch) {
			return { setMode: (0, react.useCallback)((mode) => {
				dispatch({
					type: "SET_MODE",
					mode
				});
			}, [dispatch]) };
		}
		//#endregion
		//#region src/client/hooks/usePanelLayout.ts
		/** localStorage 键（与旧项目兼容的左右宽度沿用；新增 mode/bottom-height）。 */
		const LAYOUT_KEYS = {
			mode: "visual-workflow:panel-mode",
			leftWidth: "visual-workflow:left-width",
			rightWidth: "visual-workflow:right-width",
			bottomHeight: "visual-workflow:bottom-height"
		};
		function keepLayout(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {}
		}
		/** 面板几何面（当前几何在 state.panels；拖宽过程 dispatch PANELS_SET）。 */
		function usePanelLayout(state, dispatch) {
			return { beginResize: (0, react.useCallback)((side, event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				event.preventDefault?.();
				const panels = state.panels;
				const isBottom = side === "bottom";
				const base = side === "left" ? panels.leftWidth : side === "right" ? panels.rightWidth : panels.bottomHeight;
				const startX = event.clientX;
				const startY = event.clientY;
				let lastValue = base;
				const maximum = side === "left" ? Math.max(180, Math.min(520, window.innerWidth * .46)) : side === "right" ? Math.max(180, Math.min(680, window.innerWidth * .46)) : Math.max(120, Math.min(460, window.innerHeight * .5));
				const splitter = event.currentTarget;
				const oldCursor = document.body.style.cursor;
				const oldSelect = document.body.style.userSelect;
				splitter?.classList?.add("is-dragging");
				document.body.style.cursor = isBottom ? "row-resize" : "col-resize";
				document.body.style.userSelect = "none";
				const onMove = (moveEvent) => {
					const delta = side === "left" ? moveEvent.clientX - startX : side === "right" ? startX - moveEvent.clientX : startY - moveEvent.clientY;
					lastValue = Math.max(0, Math.min(maximum, base + delta));
					dispatch({
						type: "PANELS_SET",
						panels: side === "left" ? { leftWidth: lastValue } : side === "right" ? { rightWidth: lastValue } : { bottomHeight: lastValue }
					});
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					window.removeEventListener("blur", onUp);
					splitter?.classList?.remove("is-dragging");
					document.body.style.cursor = oldCursor;
					document.body.style.userSelect = oldSelect;
					const final = Math.max(1, lastValue);
					if (side === "left") keepLayout(LAYOUT_KEYS.leftWidth, String(final));
					else if (side === "right") keepLayout(LAYOUT_KEYS.rightWidth, String(final));
					else keepLayout(LAYOUT_KEYS.bottomHeight, String(final));
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				window.addEventListener("blur", onUp);
			}, [dispatch, state.panels]) };
		}
		//#endregion
		//#region src/client/hooks/useDocumentActions.ts
		/** 文档生命周期面（保存失败抛错/提示由保存路径处理）。 */
		function useDocumentActions(state, dispatch, guard, notify, toastError, workflows, flowTemplates, templates, selection, serviceControl, remote, t) {
			const saveCanvas = (0, react.useCallback)(async () => {
				if (state.currentKind === "workflow") {
					const flow = currentFlowOf(state);
					if (!flow) return null;
					try {
						const saved = await workflows.saveWorkflow(flow, state.canvas.nodes, state.canvas.edges);
						if (saved) {
							dispatch({ type: "MARK_SAVED" });
							notify("success", t.toastSaved);
						}
						return saved;
					} catch (error) {
						toastError(error);
						return null;
					}
				}
				if (state.currentKind === "flowTemplate") {
					const template = currentFlowTemplateOf(state);
					if (!template) return null;
					try {
						const saved = await flowTemplates.saveFlowTemplate(template, state.canvas.nodes, state.canvas.edges);
						if (saved) {
							dispatch({ type: "MARK_SAVED" });
							notify("success", t.toastSaved);
						}
						return saved;
					} catch (error) {
						toastError(error);
						return null;
					}
				}
				if (state.currentKind === "service") {
					const service = currentServiceOf(state);
					if (!service) return null;
					try {
						const saved = await serviceControl.saveService(service, state.canvas.nodes, state.canvas.edges);
						if (saved) {
							dispatch({ type: "MARK_SAVED" });
							notify("success", t.toastSaved);
						}
						return saved;
					} catch (error) {
						toastError(error);
						return null;
					}
				}
				return null;
			}, [
				dispatch,
				notify,
				state,
				toastError,
				workflows,
				flowTemplates,
				serviceControl,
				t.toastSaved
			]);
			/**
			* 创建实例（图2 交互改造核心；工作台全局化改版重写）：
			*  - 实例态：等价于保存实例（名称动态为「保存实例/保存服务」）。
			*  - 模板态（「创建实例」/「创建服务」按钮，或模板态「运行」前置）：
			*      1. 目标会话 = 勾选「开启新会话」？新建主会话（createSession 端点，
			*         一次性临时选项，不持久化）: 当前主会话（state.sessionId）；
			*      2. 目标会话已有同模式实例（每会话单实例）→ 弹二次确认「新运行的工作流
			*         将会覆盖旧的工作流」；确认后**复用旧实例 id 更新内容**（运行历史
			*         按 flowId 连续可追溯）；
			*      3. 保存成功 → 切到实例态（画布绑定新实例，左栏新实例卡高亮）→
			*         afterCreate?.(saved)（「运行」入口接续启动）。
			*  - 返回：即时创建路径返回保存的文档；弹确认框路径返回 null（后续统一经
			*    afterCreate 回调接续，调用方不得依赖返回值判断成功）。
			*/
			const createInstanceFromCanvas = (0, react.useCallback)(async (afterCreate) => {
				if (state.currentKind === "workflow" || state.currentKind === "service") {
					const saved = await saveCanvas();
					return state.currentKind === "workflow" ? saved : null;
				}
				if (state.currentKind !== "flowTemplate") return null;
				const template = currentFlowTemplateOf(state);
				if (!template) return null;
				const { newSession, workspacePath } = state.instanceOptions;
				let targetSessionId = state.sessionId;
				if (newSession) try {
					const created = await remote.call(EP_CREATE_SESSION, {
						sessionId: state.sessionId,
						...String(workspacePath ?? "").trim() ? { workspacePath: String(workspacePath).trim() } : {},
						label: `${t.sessionLabelWorkflowPrefix}${template.name ?? ""}`
					});
					targetSessionId = String(created?.sessionId ?? "");
					if (!targetSessionId) throw new Error("新建会话失败：未返回会话 id");
				} catch (error) {
					toastError(error);
					return null;
				}
				const existing = state.mode === "mode1" ? state.workflows.find((item) => item.sessionId === targetSessionId) : state.services.find((item) => item.sessionId === targetSessionId);
				if (existing && state.mode === "mode2" && existing.status === "running") {
					notify("error", t.toastServiceRunningCannotOverwrite);
					return null;
				}
				/** 实际创建/覆盖（确认框 onConfirm 与即时路径共用）。 */
				const doCreate = async () => {
					try {
						if (state.mode === "mode1") {
							const source = existing;
							const draft = source ? {
								id: source.id,
								sessionId: source.sessionId,
								mode: template.mode,
								name: template.name ?? source.name,
								description: template.description ?? "",
								revision: Number(source.revision ?? 0),
								nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
								lines: JSON.parse(JSON.stringify(template.lines ?? [])),
								createdAt: source.createdAt
							} : workflows.instantiateFromTemplate(template, targetSessionId);
							const saved = await workflows.saveWorkflow(draft, state.canvas.nodes, state.canvas.edges);
							if (!saved) return;
							dispatch({ type: "MARK_SAVED" });
							workflows.openFlow(saved);
							notify("success", source ? t.toastInstanceOverwritten : t.toastCreatedInstance);
							afterCreate?.(saved);
						} else {
							const source = existing;
							const draft = source ? {
								id: source.id,
								sessionId: source.sessionId,
								name: template.name ?? source.name,
								description: template.description ?? "",
								revision: Number(source.revision ?? 0),
								nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
								lines: JSON.parse(JSON.stringify(template.lines ?? [])),
								createdAt: source.createdAt,
								updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
								status: source.status
							} : serviceControl.instantiateFromTemplate(template, targetSessionId);
							const saved = await serviceControl.saveService(draft, state.canvas.nodes, state.canvas.edges);
							if (!saved) return;
							dispatch({ type: "MARK_SAVED" });
							notify("success", source ? t.toastInstanceOverwritten : t.toastCreatedInstance);
							afterCreate?.(saved);
						}
					} catch (error) {
						toastError(error);
					}
				};
				if (existing) {
					dispatch({
						type: "CONFIRM_SET",
						confirm: {
							kind: "confirmText",
							title: t.overwriteInstanceTitle,
							message: t.overwriteInstanceMessage,
							confirmLabel: t.overwriteInstanceConfirm,
							onConfirm: () => {
								doCreate();
							}
						}
					});
					return null;
				}
				await doCreate();
				return null;
			}, [
				dispatch,
				notify,
				remote,
				saveCanvas,
				serviceControl,
				state,
				t,
				toastError,
				workflows
			]);
			/** 实例 → 模板（另存为模板）：当前实例内容复制为全局共享的工作流模板。 */
			const saveCurrentAsFlowTemplate = (0, react.useCallback)(async () => {
				const source = state.currentKind === "workflow" ? currentFlowOf(state) : state.currentKind === "service" ? currentServiceOf(state) : null;
				if (!source) return;
				try {
					const template = flowTemplates.createFlowTemplateDraft(state.mode);
					template.name = source.name;
					template.description = source.description ?? "";
					template.nodes = JSON.parse(JSON.stringify(state.canvas.nodes));
					template.lines = JSON.parse(JSON.stringify(state.canvas.edges));
					if (await flowTemplates.saveFlowTemplate(template, state.canvas.nodes, state.canvas.edges)) notify("success", t.toastSavedAsTemplate);
				} catch (error) {
					toastError(error);
				}
			}, [
				dispatch,
				flowTemplates,
				notify,
				state,
				t.toastSavedAsTemplate,
				toastError
			]);
			const openFlowById = (0, react.useCallback)((id) => {
				const flow = state.workflows.find((item) => item.id === id);
				if (!flow) return;
				workflows.openFlow(flow);
			}, [state.workflows, workflows]);
			const openServiceById = (0, react.useCallback)((id) => {
				const service = state.services.find((item) => item.id === id);
				if (!service) return;
				dispatch({
					type: "OPEN_SERVICE",
					service
				});
			}, [dispatch, state.services]);
			const openFlowTemplateById = (0, react.useCallback)((id) => {
				const template = state.flowTemplates.find((item) => item.id === id);
				if (!template) return;
				flowTemplates.openFlowTemplate(template);
			}, [state.flowTemplates, flowTemplates]);
			return {
				saveCanvas,
				createInstanceFromCanvas,
				saveCurrentAsFlowTemplate,
				openFlowById,
				openServiceById,
				openFlowTemplateById,
				selectWorkflow: (0, react.useCallback)((id) => {
					if (state.mode === "mode1") guard.guard(() => openFlowById(id));
					else guard.guard(() => openServiceById(id));
				}, [
					guard,
					openFlowById,
					openServiceById,
					state.mode
				]),
				selectFlowTemplate: (0, react.useCallback)((id) => {
					guard.guard(() => openFlowTemplateById(id));
				}, [guard, openFlowTemplateById]),
				createNew: (0, react.useCallback)((tab, section) => {
					if (tab === "workflow") {
						if (section === "flowTemplate") {
							const draft = flowTemplates.createFlowTemplateDraft(state.mode);
							flowTemplates.openFlowTemplate(draft);
							notify("info", t.newWorkflow);
							return;
						}
						notify("info", t.newWorkflow);
						return;
					}
					if (tab === "role") {
						const template = templates.createTemplateDraft("role");
						selection.selectEditor({
							source: "template",
							kind: "role",
							id: template.id
						});
						selection.selectLib("role", template.id);
						notify("info", t.newTemplate);
						return;
					}
					if (tab === "data") {
						const kind = section === "database" ? "database" : "file";
						const template = templates.createTemplateDraft(kind);
						selection.selectEditor({
							source: "template",
							kind,
							id: template.id
						});
						selection.selectLib(kind, template.id);
						notify("info", t.newTemplate);
						return;
					}
					if (tab === "other" && section === "group") {
						const template = templates.createTemplateDraft("group");
						selection.selectEditor({
							source: "template",
							kind: "group",
							id: template.id
						});
						selection.selectLib("groupTemplate", template.id);
						notify("info", t.newTemplate);
						return;
					}
				}, [
					notify,
					selection,
					serviceControl,
					state.mode,
					state.sessionId,
					t.newTemplate,
					t.newWorkflow,
					flowTemplates,
					templates,
					workflows
				])
			};
		}
		//#endregion
		//#region src/client/hooks/useCanvasActions.ts
		/** 画布编辑面（remember 需在变更 dispatch 前调用；远端无 IO）。 */
		function useCanvasActions(state, dispatch, notify, history, t) {
			const rememberGraph = (0, react.useCallback)(() => {
				history.remember();
			}, [history]);
			const moveNode = (0, react.useCallback)((id, position) => {
				dispatch({
					type: "NODE_MOVED",
					id,
					position
				});
			}, [dispatch]);
			const onNodeDragStart = (0, react.useCallback)(() => {
				history.remember();
			}, [history]);
			const onConnect = (0, react.useCallback)((connection) => {
				const problem = connectionProblem(state.canvas.nodes, state.canvas.edges, connection);
				if (!problem.valid) {
					notify("error", connectionProblemMessage(problem, t));
					return;
				}
				history.remember();
				dispatch({
					type: "EDGE_ADDED",
					edge: {
						id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						source: connection.source,
						target: connection.target,
						sourceHandle: connection.sourceHandle,
						targetHandle: connection.targetHandle
					}
				});
			}, [
				dispatch,
				history,
				notify,
				state.canvas.nodes,
				state.canvas.edges,
				t
			]);
			const onConnectionRejected = (0, react.useCallback)(() => {
				notify("error", t.invalidConnection);
			}, [notify, t.invalidConnection]);
			const tidyGraph = (0, react.useCallback)(() => {
				history.remember();
				dispatch({
					type: "GRAPH_REPLACED",
					nodes: layoutNodes(state.canvas.nodes, flowToCanvasLines(state.canvas.edges)),
					edges: state.canvas.edges,
					dirty: true
				});
				notify("success", t.toastTidy);
			}, [
				dispatch,
				history,
				notify,
				state.canvas.edges,
				state.canvas.nodes,
				t.toastTidy
			]);
			const clearGraph = (0, react.useCallback)(() => {
				dispatch({
					type: "CONFIRM_SET",
					confirm: {
						kind: "confirmText",
						title: t.clearCanvas,
						message: t.clearCanvasHint,
						confirmLabel: t.clear,
						onConfirm: () => {
							history.remember();
							dispatch({
								type: "GRAPH_REPLACED",
								nodes: [],
								edges: [],
								dirty: true
							});
							dispatch({ type: "CLEAR_SELECTION" });
							notify("info", t.toastCleared);
						}
					}
				});
			}, [
				dispatch,
				history,
				notify,
				t.clear,
				t.clearCanvas,
				t.clearCanvasHint,
				t.toastCleared
			]);
			const removeSelected = (0, react.useCallback)(() => {
				if (!state.selection.nodeId) return;
				const id = state.selection.nodeId;
				const node = state.canvas.nodes.find((item) => item.id === id);
				if (!node) return;
				const proxies = node.kind === "parent" || node.kind === "agent" ? state.canvas.nodes.filter((item) => item.kind === "proxy" && item.proxySourceId === node.id) : [];
				if (proxies.length > 0) {
					dispatch({
						type: "CONFIRM_SET",
						confirm: {
							kind: "confirmText",
							title: t.deleteNode,
							message: t.proxyCascadeHint.replace("{count}", String(proxies.length)),
							onConfirm: () => {
								removeNodeNow(id);
							}
						}
					});
					return;
				}
				dispatch({
					type: "CONFIRM_SET",
					confirm: {
						kind: "confirmText",
						title: t.deleteNode,
						message: t.confirmDelete,
						onConfirm: () => {
							removeNodeNow(id);
						}
					}
				});
			}, [
				dispatch,
				state.canvas.nodes,
				state.selection.nodeId,
				t.confirmDelete,
				t.deleteNode,
				t.proxyCascadeHint
			]);
			const removeNodeNow = (0, react.useCallback)((id) => {
				history.remember();
				const node = state.canvas.nodes.find((item) => item.id === id);
				const groupId = node?.kind === "parent" || node?.kind === "agent" ? node.data.groupId : null;
				const removed = /* @__PURE__ */ new Set([id]);
				if (node && (node.kind === "parent" || node.kind === "agent")) {
					for (const item of state.canvas.nodes) if (item.kind === "proxy" && item.proxySourceId === id) removed.add(item.id);
				}
				if (groupId) dispatch({
					type: "GRAPH_REPLACED",
					nodes: state.canvas.nodes.filter((item) => !removed.has(item.id)).map((item) => item.kind === "group" && (item.data.memberIds ?? []).includes(id) ? {
						...item,
						data: {
							...item.data,
							memberIds: item.data.memberIds.filter((memberId) => memberId !== id)
						}
					} : item),
					edges: state.canvas.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
					dirty: true
				});
				else dispatch({
					type: "NODE_REMOVED",
					id
				});
				dispatch({ type: "CLEAR_SELECTION" });
				notify("info", t.toastDeleted);
			}, [
				dispatch,
				history,
				notify,
				state.canvas.edges,
				state.canvas.nodes,
				t.toastDeleted
			]);
			return {
				rememberGraph,
				moveNode,
				onNodeDragStart,
				onConnect,
				onConnectionRejected,
				tidyGraph,
				clearGraph,
				removeSelected,
				removeNodeNow,
				removeLine: (0, react.useCallback)((id) => {
					history.remember();
					dispatch({
						type: "EDGE_REMOVED",
						id
					});
					dispatch({ type: "CLEAR_SELECTION" });
					notify("info", t.toastDeleted);
				}, [
					dispatch,
					history,
					notify,
					t.toastDeleted
				]),
				placeTemplateNode: (0, react.useCallback)((kind, templateId, position) => {
					if (!state.currentId) return;
					const template = state.templates[kind].find((item) => item.id === templateId);
					if (!template) return;
					const data = templateToNodeData(kind, template) ?? {};
					const nodeKind = kind === "role" ? "agent" : kind;
					const node = {
						id: `${nodeKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind: nodeKind,
						position,
						data
					};
					history.remember();
					dispatch({
						type: "NODE_ADDED",
						node
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastNodeAdded);
				}, [
					dispatch,
					history,
					notify,
					state.currentId,
					state.templates,
					t.toastNodeAdded
				]),
				placeParentNode: (0, react.useCallback)((templateId, position) => {
					if (!state.currentId) return;
					if (state.canvas.nodes.some((item) => item.kind === "parent")) {
						notify("error", t.parentDuplicatedHint);
						return;
					}
					const data = templateToNodeData("role", state.templates.role.find((item) => item.id === templateId)) ?? {};
					const node = {
						id: `parent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind: "parent",
						position,
						data
					};
					history.remember();
					dispatch({
						type: "NODE_ADDED",
						node
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastNodeAdded);
				}, [
					dispatch,
					history,
					notify,
					state.canvas.nodes,
					state.currentId,
					state.templates.role,
					t.parentDuplicatedHint,
					t.toastNodeAdded
				]),
				placeStageNode: (0, react.useCallback)((kind, position) => {
					if (!state.currentId) return;
					if ((kind === "start" || kind === "end") && state.canvas.nodes.some((item) => item.kind === kind)) {
						notify("error", t.stageDuplicatedHint);
						return;
					}
					const label = stageTemplateKinds(state.mode).find((item) => item.kind === kind)?.label ?? kind;
					const node = {
						id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind,
						position,
						data: { label }
					};
					history.remember();
					dispatch({
						type: "NODE_ADDED",
						node
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastNodeAdded);
				}, [
					dispatch,
					history,
					notify,
					state.canvas.nodes,
					state.currentId,
					state.mode,
					t.stageDuplicatedHint,
					t.toastNodeAdded
				]),
				placeGroupNode: (0, react.useCallback)((position) => {
					if (!state.currentId) return;
					const node = {
						id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind: "group",
						position,
						data: {
							label: String(t.groupDefaultName ?? "协作组"),
							collabPrompt: "",
							memberIds: [],
							size: {
								w: 300,
								h: 220
							}
						}
					};
					history.remember();
					dispatch({
						type: "NODE_ADDED",
						node
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastNodeAdded);
				}, [
					dispatch,
					history,
					notify,
					state.currentId,
					t.groupDefaultName,
					t.toastNodeAdded
				]),
				placeGroupFromTemplate: (0, react.useCallback)((templateId, position) => {
					if (!state.currentId) return;
					const template = state.templates.group.find((item) => item.id === templateId);
					const data = template ? {
						label: String(template.name ?? ""),
						collabPrompt: String(template.collabPrompt ?? ""),
						memberIds: [],
						size: {
							w: 300,
							h: 220
						}
					} : {
						label: String(t.groupDefaultName ?? "协作组"),
						collabPrompt: "",
						memberIds: [],
						size: {
							w: 300,
							h: 220
						}
					};
					const node = {
						id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind: "group",
						position,
						data
					};
					history.remember();
					dispatch({
						type: "NODE_ADDED",
						node
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastNodeAdded);
				}, [
					dispatch,
					history,
					notify,
					state.currentId,
					state.templates.group,
					t.groupDefaultName,
					t.toastNodeAdded
				]),
				placeTemplateIntoGroup: (0, react.useCallback)((kind, templateId, groupId, position) => {
					if (!state.currentId) return;
					const template = state.templates[kind].find((item) => item.id === templateId);
					const group = state.canvas.nodes.find((item) => item.id === groupId);
					if (!template || !group || group.kind !== "group") return;
					if ((group.data.memberIds ?? []).length >= 8) {
						notify("error", t.groupMemberLimitHint);
						return;
					}
					const data = templateToNodeData(kind, template) ?? {};
					const node = {
						id: `${kind === "role" ? "agent" : kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						kind: "agent",
						position: {
							x: group.position.x + 10,
							y: group.position.y + 10
						},
						data: {
							...data,
							groupId
						}
					};
					history.remember();
					dispatch({
						type: "GRAPH_REPLACED",
						nodes: joinNodeToGroup([...state.canvas.nodes, node], node.id, groupId),
						edges: dropNodeFlowLines(state.canvas.edges, node.id),
						dirty: true
					});
					dispatch({
						type: "SELECT_NODE",
						id: node.id
					});
					notify("success", t.toastGroupMemberAdded);
				}, [
					dispatch,
					history,
					notify,
					state.canvas.edges,
					state.canvas.nodes,
					state.currentId,
					state.templates,
					t.groupMemberLimitHint,
					t.toastGroupMemberAdded
				]),
				onGroupResize: (0, react.useCallback)((id, size) => {
					dispatch({
						type: "NODE_DATA_PATCH",
						id,
						patch: { size }
					});
				}, [dispatch]),
				addNodeToGroup: (0, react.useCallback)((nodeId, groupId) => {
					const group = state.canvas.nodes.find((item) => item.id === groupId);
					if (!group || group.kind !== "group") return;
					const node = state.canvas.nodes.find((item) => item.id === nodeId);
					if (!node || node.kind !== "parent" && node.kind !== "agent") return;
					const members = group.data.memberIds ?? [];
					if (members.includes(nodeId)) return;
					if (members.length >= 8) {
						notify("error", t.groupMemberLimitHint);
						return;
					}
					history.remember();
					dispatch({
						type: "GRAPH_REPLACED",
						nodes: joinNodeToGroup(state.canvas.nodes, nodeId, groupId),
						edges: dropNodeFlowLines(state.canvas.edges, nodeId),
						dirty: true
					});
					notify("success", t.toastGroupMemberAdded);
				}, [
					dispatch,
					history,
					notify,
					state.canvas.edges,
					state.canvas.nodes,
					t.groupMemberLimitHint,
					t.toastGroupMemberAdded
				]),
				copyToProxy: (0, react.useCallback)(() => {
					if (!state.selection.nodeId) return;
					const main = state.canvas.nodes.find((item) => item.id === state.selection.nodeId);
					if (!main || main.kind !== "parent" && main.kind !== "agent") return;
					history.remember();
					const id = `proxy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
					dispatch({
						type: "NODE_ADDED",
						node: {
							id,
							kind: "proxy",
							position: {
								x: main.position.x + 40,
								y: main.position.y + 120
							},
							data: {},
							proxySourceId: main.id
						}
					});
					dispatch({
						type: "SELECT_NODE",
						id
					});
					notify("info", t.toastProxyCreated);
				}, [
					dispatch,
					history,
					notify,
					state.canvas.nodes,
					state.selection.nodeId,
					t.toastProxyCreated
				]),
				removeGroupMember: (0, react.useCallback)((memberId) => {
					const base = consolidateGroups(state.canvas.nodes);
					const member = base.find((item) => item.id === memberId);
					const groupId = member && (member.kind === "parent" || member.kind === "agent") ? member.data.groupId ?? null : null;
					if (!groupId) return;
					const group = base.find((item) => item.id === groupId && item.kind === "group");
					if (!group) return;
					history.remember();
					const nextMembers = [...new Set(Array.isArray(group.data.memberIds) ? group.data.memberIds : [])].filter((item) => item !== memberId);
					dispatch({
						type: "GRAPH_REPLACED",
						nodes: base.map((n) => {
							if (n.id === groupId && n.kind === "group") return {
								...n,
								data: {
									...n.data,
									memberIds: nextMembers
								}
							};
							if (n.id === memberId) return {
								...n,
								data: {
									...n.data,
									groupId: null
								}
							};
							return n;
						}),
						edges: state.canvas.edges,
						dirty: true
					});
				}, [
					dispatch,
					history,
					state.canvas.edges,
					state.canvas.nodes
				]),
				swapNodePorts: (0, react.useCallback)((id) => {
					const node = state.canvas.nodes.find((item) => item.id === id);
					if (!node) return;
					history.remember();
					dispatch({
						type: "NODE_DATA_PATCH",
						id,
						patch: { swapPorts: node.data.swapPorts !== true }
					});
				}, [
					dispatch,
					history,
					state.canvas.nodes
				])
			};
		}
		//#endregion
		//#region src/client/hooks/useEditorActions.ts
		/** 编辑器面（保存/删除失败 toast；节点/连线删除复用画布面）。 */
		function useEditorActions(state, dispatch, notify, toastError, t, workflows, flowTemplates, templates, selection, remote, saveCanvas, removeSelected, removeLine, selectWorkflow, selectFlowTemplate) {
			return {
				selectLibraryCard: (0, react.useCallback)((kind, id) => {
					if (kind === "workflow" || kind === "service") {
						selectWorkflow(id);
						return;
					}
					if (kind === "workflowTemplate") {
						selectFlowTemplate(id);
						return;
					}
					selection.selectLib(kind, id);
					if (kind === "parentTemplate") {
						selection.selectEditor({
							source: "template",
							kind: "role",
							id
						});
						return;
					}
					if (kind === "stage") {
						selection.selectEditor(null);
						return;
					}
					if (kind === "groupTemplate") {
						selection.selectEditor({
							source: "template",
							kind: "group",
							id
						});
						return;
					}
					const editorKind = {
						role: "role",
						file: "file",
						database: "database"
					}[kind];
					if (editorKind) selection.selectEditor({
						source: "template",
						kind: editorKind,
						id
					});
				}, [
					selectWorkflow,
					selectFlowTemplate,
					selection
				]),
				patchEditor: (0, react.useCallback)((patch) => {
					const editor = state.editor;
					if (!editor) return;
					if (editor.source === "workflow" || editor.source === "service" || editor.source === "flowTemplate") {
						dispatch({
							type: "DOC_PATCH",
							patch: {
								name: patch.name,
								description: patch.description
							}
						});
						return;
					}
					if (editor.source === "template") {
						const template = state.templates[editor.kind].find((item) => item.id === editor.id);
						if (!template) return;
						const normalized = { ...patch };
						delete normalized.label;
						dispatch({
							type: "TEMPLATE_UPDATED",
							kind: editor.kind,
							template: {
								...template,
								...normalized
							}
						});
						return;
					}
					if (editor.source === "node") {
						if (!state.canvas.nodes.find((item) => item.id === editor.id)) return;
						const normalized = { ...patch };
						delete normalized.name;
						dispatch({
							type: "NODE_DATA_PATCH",
							id: editor.id,
							patch: normalized
						});
						return;
					}
					if (editor.source === "edge") dispatch({
						type: "EDGE_PATCH",
						id: editor.id,
						patch
					});
				}, [
					dispatch,
					state.canvas.nodes,
					state.editor,
					state.templates
				]),
				saveEditor: (0, react.useCallback)(async () => {
					const editor = state.editor;
					if (!editor) return;
					if (editor.source === "workflow" || editor.source === "service") {
						await saveCanvas();
						return;
					}
					if (editor.source === "flowTemplate") {
						await saveCanvas();
						return;
					}
					if (editor.source === "template") {
						const template = state.templates[editor.kind].find((item) => item.id === editor.id);
						if (!template) return;
						try {
							await templates.saveTemplate(editor.kind, template);
							notify("success", t.toastSaved);
						} catch (error) {
							toastError(error);
						}
						return;
					}
					if (editor.source === "node" || editor.source === "edge") {
						await saveCanvas();
						return;
					}
				}, [
					notify,
					saveCanvas,
					state.canvas.nodes,
					state.editor,
					state.templates,
					t.toastSaved,
					templates,
					toastError
				]),
				deleteEditor: (0, react.useCallback)(async () => {
					const editor = state.editor;
					if (!editor) return;
					if (editor.source === "workflow") {
						const flow = currentFlowOf(state);
						if (!flow) return;
						if (flow._draft === true) {
							dispatch({
								type: "WORKFLOW_REMOVED",
								id: flow.id
							});
							dispatch({ type: "CLEAR_CANVAS" });
							dispatch({ type: "CLEAR_SELECTION" });
							notify("info", t.toastDeleted);
							return;
						}
						dispatch({
							type: "CONFIRM_SET",
							confirm: {
								kind: "confirmText",
								title: t.deleteFlow,
								message: `${t.confirmDelete}（${flow.name}）`,
								onConfirm: () => {
									workflows.deleteWorkflow(flow).then(() => {
										dispatch({ type: "CLEAR_CANVAS" });
										notify("info", t.toastDeleted);
									}).catch((error) => {
										toastError(error);
										dispatch({
											type: "CONFIRM_SET",
											confirm: null
										});
									});
								}
							}
						});
						return;
					}
					if (editor.source === "service") {
						const service = currentServiceOf(state);
						if (!service) return;
						if (service._draft === true) {
							dispatch({
								type: "SERVICE_REMOVED",
								id: service.id
							});
							dispatch({ type: "CLEAR_CANVAS" });
							dispatch({ type: "CLEAR_SELECTION" });
							notify("info", t.toastDeleted);
							return;
						}
						dispatch({
							type: "CONFIRM_SET",
							confirm: {
								kind: "confirmText",
								title: t.deleteFlow,
								message: `${t.confirmDelete}（${service.name}）`,
								onConfirm: () => {
									remote.call(EP_DELETE_SERVICE, {
										sessionId: service.sessionId,
										id: service.id
									}).then(() => {
										dispatch({
											type: "SERVICE_REMOVED",
											id: service.id
										});
										dispatch({ type: "CLEAR_CANVAS" });
										notify("info", t.toastDeleted);
									}).catch((error) => {
										toastError(error);
										dispatch({
											type: "CONFIRM_SET",
											confirm: null
										});
									});
								}
							}
						});
						return;
					}
					if (editor.source === "flowTemplate") {
						const template = state.flowTemplates.find((item) => item.id === editor.id);
						if (!template) return;
						if (template._draft === true) {
							dispatch({
								type: "FLOW_TEMPLATE_REMOVED",
								id: template.id
							});
							dispatch({ type: "CLEAR_CANVAS" });
							dispatch({ type: "CLEAR_SELECTION" });
							notify("info", t.toastDeleted);
							return;
						}
						dispatch({
							type: "CONFIRM_SET",
							confirm: {
								kind: "confirmText",
								title: t.deleteFlow,
								message: `${t.confirmDelete}（${template.name}）`,
								onConfirm: () => {
									flowTemplates.deleteFlowTemplate(template.id).then(() => {
										dispatch({ type: "CLEAR_CANVAS" });
										notify("info", t.toastDeleted);
									}).catch((error) => {
										toastError(error);
										dispatch({
											type: "CONFIRM_SET",
											confirm: null
										});
									});
								}
							}
						});
						return;
					}
					if (editor.source === "template") {
						const template = state.templates[editor.kind].find((item) => item.id === editor.id);
						if (!template) return;
						if (template._draft === true) {
							dispatch({
								type: "TEMPLATE_REMOVED",
								kind: editor.kind,
								id: editor.id
							});
							dispatch({ type: "CLEAR_SELECTION" });
							notify("info", t.toastDeleted);
							return;
						}
						dispatch({
							type: "CONFIRM_SET",
							confirm: {
								kind: "confirmText",
								title: t.deleteTemplateTitle,
								message: t.deleteTemplateMessage.replace("{name}", String(template.name ?? "")),
								onConfirm: () => {
									templates.deleteTemplate(editor.kind, editor.id).then(() => {
										dispatch({ type: "CLEAR_SELECTION" });
										notify("info", t.toastDeleted);
									}).catch((error) => {
										toastError(error);
										dispatch({
											type: "CONFIRM_SET",
											confirm: null
										});
									});
								}
							}
						});
						return;
					}
					if (editor.source === "node") {
						removeSelected();
						return;
					}
					if (editor.source === "edge") removeLine(editor.id);
				}, [
					dispatch,
					notify,
					removeLine,
					removeSelected,
					state.editor,
					state.sessionId,
					state.templates,
					state.flowTemplates,
					t.confirmDelete,
					t.deleteFlow,
					t.deleteTemplateMessage,
					t.deleteTemplateTitle,
					t.toastDeleted,
					templates,
					flowTemplates,
					toastError,
					workflows
				])
			};
		}
		//#endregion
		//#region src/client/hooks/useRunActions.ts
		/** 运行与服务控制面（远端失败抛错，由调用方 toast）。 */
		function useRunActions(state, dispatch, notify, toastError, t, remote, runControl, serviceControl, saveCanvas, createInstanceFromCanvas) {
			return {
				startRun: (0, react.useCallback)(async () => {
					if (state.mode !== "mode1") return;
					if (state.currentKind === "flowTemplate") {
						createInstanceFromCanvas((created) => {
							const flow = created;
							const hasStart = state.canvas.nodes.some((node) => node.kind === "start");
							const hasEnd = state.canvas.nodes.some((node) => node.kind === "end");
							if (!hasStart || !hasEnd) {
								notify("error", t.needStartAndEnd);
								return;
							}
							runControl.startRun(flow.sessionId, flow.id).then((runId) => {
								if (runId) notify("success", t.toastRunning);
							}).catch((error) => toastError(error));
						});
						return;
					}
					if (!currentFlowOf(state)) return;
					const hasStart = state.canvas.nodes.some((node) => node.kind === "start");
					const hasEnd = state.canvas.nodes.some((node) => node.kind === "end");
					if (!hasStart || !hasEnd) {
						notify("error", t.needStartAndEnd);
						return;
					}
					const saved = await saveCanvas();
					if (!saved) return;
					try {
						if (await runControl.startRun(saved.sessionId, saved.id)) notify("success", t.toastRunning);
					} catch (error) {
						toastError(error);
					}
				}, [
					createInstanceFromCanvas,
					notify,
					runControl,
					saveCanvas,
					state,
					t.needStartAndEnd,
					t.toastRunning,
					toastError
				]),
				stopRun: (0, react.useCallback)(async () => {
					if (!state.run.runId) return;
					try {
						const flow = currentFlowOf(state);
						await runControl.stopRun(state.run.sessionId ?? flow?.sessionId ?? state.sessionId, state.run.runId);
						notify("info", t.toastStopped);
					} catch (error) {
						toastError(error);
					}
				}, [
					notify,
					runControl,
					state.run.runId,
					state.run.sessionId,
					state.sessionId,
					t.toastStopped,
					toastError
				]),
				openHistory: (0, react.useCallback)(async () => {
					dispatch({
						type: "HISTORY_OPEN",
						open: true
					});
					const flow = currentFlowOf(state);
					if (!flow) return;
					try {
						const historySessionId = state.run.sessionId ?? flow.sessionId;
						const items = await remote.call(EP_RUN_HISTORY, {
							sessionId: historySessionId,
							flowId: flow.id
						});
						dispatch({
							type: "RUN_HISTORY_LOADED",
							items: Array.isArray(items) ? items : []
						});
					} catch (error) {
						toastError(error);
					}
				}, [
					dispatch,
					state,
					remote,
					toastError
				]),
				resumeRun: (0, react.useCallback)(async (runId) => {
					const flow = currentFlowOf(state);
					if (!flow) return;
					try {
						const result = await remote.call(EP_RUN_RESUME, {
							sessionId: state.run.sessionId ?? flow.sessionId,
							flowId: flow.id,
							runId
						});
						const newRunId = String(result?.runId ?? "");
						if (newRunId) dispatch({
							type: "RUN_STARTED",
							runId: newRunId,
							...state.run.sessionId ? { runSessionId: state.run.sessionId } : {}
						});
						dispatch({
							type: "HISTORY_OPEN",
							open: false
						});
						notify("success", t.toastResuming);
					} catch (error) {
						toastError(error);
					}
				}, [
					dispatch,
					notify,
					state,
					t.toastResuming,
					toastError
				]),
				startService: (0, react.useCallback)(async () => {
					if (state.currentKind === "flowTemplate") {
						if (!currentFlowTemplateOf(state)) return;
						const hasInput = state.canvas.nodes.some((node) => node.kind === "start");
						const hasOutput = state.canvas.nodes.some((node) => node.kind === "end");
						const hasParent = state.canvas.nodes.some((node) => node.kind === "parent");
						if (!hasInput || !hasOutput) {
							notify("error", t.needStartAndEnd);
							return;
						}
						if (!hasParent) {
							notify("error", t.needParentForService);
							return;
						}
						createInstanceFromCanvas((created) => {
							const service = created;
							serviceControl.startService(service.id, service.sessionId).then(() => {
								notify("success", t.toastServiceStarted);
							}).catch((error) => toastError(error));
						});
						return;
					}
					if (!currentServiceOf(state)) return;
					const hasInput = state.canvas.nodes.some((node) => node.kind === "start");
					const hasOutput = state.canvas.nodes.some((node) => node.kind === "end");
					const hasParent = state.canvas.nodes.some((node) => node.kind === "parent");
					if (!hasInput || !hasOutput) {
						notify("error", t.needStartAndEnd);
						return;
					}
					if (!hasParent) {
						notify("error", t.needParentForService);
						return;
					}
					const saved = await saveCanvas();
					if (!saved) return;
					try {
						await serviceControl.startService(saved.id, saved.sessionId);
						notify("success", t.toastServiceStarted);
					} catch (error) {
						toastError(error);
					}
				}, [
					createInstanceFromCanvas,
					notify,
					saveCanvas,
					serviceControl,
					state,
					t.needParentForService,
					t.needStartAndEnd,
					t.toastServiceStarted,
					toastError
				]),
				stopService: (0, react.useCallback)(async () => {
					const service = currentServiceOf(state);
					if (!service) return;
					try {
						await serviceControl.stopService(service.id, service.sessionId);
						notify("info", t.toastServiceStopped);
					} catch (error) {
						toastError(error);
					}
				}, [
					notify,
					serviceControl,
					t.toastServiceStopped,
					toastError
				])
			};
		}
		//#endregion
		//#region src/client/lib/files.ts
		/** 读取文件为 UTF-8 文本。 */
		function readFileAsText(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result ?? ""));
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error("read failed"));
				reader.readAsText(file);
			});
		}
		/** 读取文件为 Base64（DataURL 剥前缀）。 */
		function readFileAsBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result = String(reader.result ?? "");
					const comma = result.indexOf(",");
					resolve(comma >= 0 ? result.slice(comma + 1) : result);
				};
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error("read failed"));
				reader.readAsDataURL(file);
			});
		}
		/** 浏览器下载（Blob + 临时 a 标签）。 */
		function download(content, fileName, mediaType = "application/json") {
			const blob = new Blob([content], { type: mediaType });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1e3);
		}
		/** 判定 JSON 文本是否为角色模板导出。 */
		function isRoleTemplateBundle(json) {
			try {
				const parsed = JSON.parse(json);
				return parsed?.format === "dsh-vw-template" && parsed?.template != null;
			} catch {
				return false;
			}
		}
		//#endregion
		//#region src/client/hooks/useStudioTransfer.ts
		/** 导入导出与文件/数据库交互面（远端失败抛错，由调用方 toast）。 */
		function useStudioTransfer(state, dispatch, notify, toastError, t, remote, templates, flowTemplates, workflows, patchEditor, editorData, personaInputRef, groupMdInputRef) {
			return {
				exportCurrent: (0, react.useCallback)(async () => {
					if (editorData?.kind === "workflow" || editorData?.kind === "service") {
						const flow = currentFlowOf(state) ?? currentServiceOf(state);
						if (!flow) return;
						try {
							const result = await remote.call(EP_EXPORT_WORKFLOW, {
								sessionId: flow.sessionId,
								id: flow.id
							});
							const name = String(flow.name ?? t.exportFileName).replace(/[\\/:*?"<>|]/g, "_");
							download(String(result?.json ?? ""), `${name}.json`);
							notify("success", t.toastExported);
						} catch (error) {
							toastError(error);
						}
						return;
					}
					if (editorData?.kind === "role" && editorData.template) {
						try {
							const result = await remote.call(EP_EXPORT_AGENT_TEMPLATE, { id: String(editorData.templateId ?? "") });
							const name = String(editorData.name ?? "agent").replace(/[\\/:*?"<>|]/g, "_");
							download(String(result?.json ?? ""), `${name}.agent.json`);
							notify("success", t.toastExported);
						} catch (error) {
							toastError(error);
						}
						return;
					}
					notify("error", t.exportEmpty);
				}, [
					editorData,
					currentFlowOf,
					notify,
					remote,
					t.exportEmpty,
					t.exportFileName,
					t.toastExported,
					toastError
				]),
				handleImportFile: (0, react.useCallback)(async (file) => {
					if (!file) return;
					try {
						const json = await readFileAsText(file);
						if (isRoleTemplateBundle(json)) {
							const result = await remote.call(EP_IMPORT_AGENT_TEMPLATE, { json });
							if (result?.conflict) {
								dispatch({
									type: "CONFIRM_SET",
									confirm: {
										kind: "importConflict",
										kind2: "agent",
										json,
										name: String(result.existingName ?? ""),
										message: t.importConflictMessage.replace("{name}", String(result.existingName ?? ""))
									}
								});
								return;
							}
							await templates.loadTemplates();
							notify("success", t.toastImported);
							return;
						}
						const result = await remote.call(EP_IMPORT_WORKFLOW, { json });
						if (result?.conflict) {
							dispatch({
								type: "CONFIRM_SET",
								confirm: {
									kind: "importConflict",
									kind2: "workflow",
									json,
									name: String(result.existingName ?? ""),
									message: t.importConflictMessage.replace("{name}", String(result.existingName ?? ""))
								}
							});
							return;
						}
						await flowTemplates.loadFlowTemplates();
						notify("success", t.toastImported);
					} catch (error) {
						toastError(error);
					}
				}, [
					dispatch,
					notify,
					remote,
					t.importConflictMessage,
					t.toastImported,
					templates,
					flowTemplates,
					toastError,
					workflows
				]),
				resolveImportConflict: (0, react.useCallback)(async (mode) => {
					const confirm = state.confirm;
					dispatch({
						type: "CONFIRM_SET",
						confirm: null
					});
					if (confirm?.kind !== "importConflict") return;
					const json = confirm.json;
					try {
						if (confirm.kind2 === "agent") {
							await remote.call(EP_IMPORT_AGENT_TEMPLATE, {
								json,
								conflictMode: mode
							});
							await templates.loadTemplates();
						} else {
							await remote.call(EP_IMPORT_WORKFLOW, {
								json,
								conflictMode: mode
							});
							await flowTemplates.loadFlowTemplates();
						}
						notify("success", t.toastImported);
					} catch (error) {
						toastError(error);
					}
				}, [
					dispatch,
					notify,
					remote,
					state.confirm,
					t.toastImported,
					templates,
					flowTemplates,
					toastError
				]),
				loadPersonaMd: (0, react.useCallback)(async () => {
					personaInputRef.current?.click();
				}, []),
				onPersonaMdSelected: (0, react.useCallback)(async (file) => {
					if (!file) return;
					try {
						patchEditor({
							systemPrompt: await readFileAsText(file),
							systemPromptSource: file.name
						});
						notify("success", t.toastSaved);
					} catch (error) {
						toastError(error);
					}
				}, [
					notify,
					patchEditor,
					t.toastSaved,
					toastError
				]),
				loadGroupMd: (0, react.useCallback)(() => {
					groupMdInputRef.current?.click();
				}, []),
				onGroupMdSelected: (0, react.useCallback)(async (file) => {
					if (!file) return;
					try {
						patchEditor({ collabPrompt: await readFileAsText(file) });
						notify("success", t.toastSaved);
					} catch (error) {
						toastError(error);
					}
				}, [
					notify,
					patchEditor,
					t.toastSaved,
					toastError
				]),
				onFileSelect: (0, react.useCallback)(async (picked) => {
					const editor = state.editor;
					if (!editor) return;
					const isTemplate = editor.source === "template";
					const isNode = editor.source === "node";
					if (!isTemplate && !isNode) return;
					try {
						const fileKind = editor.source === "template" ? (state.templates[editor.kind] ?? []).find((item) => item.id === editor.id) : state.canvas.nodes.find((item) => item.id === editor.id)?.data;
						if (String(fileKind?.fileKind ?? "text") === "text") {
							const { file } = { file: picked[0] };
							patchEditor({
								content: await readFileAsText(file),
								fileName: file.name,
								files: []
							});
						} else {
							const uploaded = [];
							for (const file of picked) {
								const base64 = await readFileAsBase64(file);
								const result = await remote.call(EP_FILE_UPLOAD, {
									name: file.name,
									base64
								});
								uploaded.push({
									fileName: result?.fileName ?? file.name,
									managedPath: result?.managedPath ?? ""
								});
							}
							patchEditor({ files: [...(() => {
								const data = editor.source === "template" ? (state.templates[editor.kind] ?? []).find((item) => item.id === editor.id) : state.canvas.nodes.find((item) => item.id === editor.id)?.data;
								return Array.isArray(data?.files) ? data.files : [];
							})(), ...uploaded] });
						}
						notify("success", t.toastSaved);
					} catch (error) {
						toastError(error);
					}
				}, [
					notify,
					patchEditor,
					remote,
					state.canvas.nodes,
					state.editor,
					state.templates,
					t.toastSaved,
					toastError
				]),
				testDbConnection: (0, react.useCallback)(async () => {
					const editor = state.editor;
					if (editor?.source !== "node") return;
					const node = state.canvas.nodes.find((item) => item.id === editor.id);
					if (!node || node.kind !== "database") return;
					try {
						await remote.call(EP_DB_TEST, { node });
						notify("success", copyDbSuccess(t));
					} catch (error) {
						notify("error", String(error?.message ?? error));
					}
				}, [
					notify,
					remote,
					state.canvas.nodes,
					state.editor
				])
			};
		}
		/** 数据库测试成功提示文案。 */
		function copyDbSuccess(t) {
			return t.dbTestSuccess;
		}
		const GRAPH_NODE_SIZE = {
			w: 208,
			h: 116
		};
		const GRAPH_MIN_ZOOM = .5;
		const GRAPH_MAX_ZOOM = 2.5;
		/** 节点实际尺寸（协作组卡片可拉伸，尺寸存 data.size；阶段节点用紧凑卡）。 */
		function nodeSizeOf(node) {
			if (node.kind === "group") {
				const size = node.data?.size ?? {};
				return {
					w: Number(size.w) > 0 ? Number(size.w) : 300,
					h: Number(size.h) > 0 ? Number(size.h) : 220
				};
			}
			if (node.kind === "start" || node.kind === "end" || node.kind === "pause") return {
				w: 168,
				h: 88
			};
			return {
				w: 208,
				h: 116
			};
		}
		/** 接点垂直位置（百分比）：db 最上、ctx 上、flow 下。 */
		function handleY(handle) {
			if (handle === "db-in" || handle === "db-out") return .22;
			if (handle === "ctx-in" || handle === "ctx-out") return .42;
			return .72;
		}
		function clamp(value, minimum, maximum) {
			return Math.min(maximum, Math.max(minimum, value));
		}
		/** 成员所在组（画布节点含该成员）。 */
		function groupOfMember(byId, memberId) {
			for (const node of byId.values()) if (node.kind === "group" && (node.data.memberIds ?? []).includes(memberId)) return node;
			return null;
		}
		/** 组内成员连线锚点（组卡片左/右边缘 + 成员行中心）。 */
		function memberAnchor(group, memberId, side) {
			const index = (group.data.memberIds ?? []).indexOf(memberId);
			if (index < 0) return null;
			const size = nodeSizeOf(group);
			const y = group.position.y + 78 + index * 38 + 19;
			return {
				x: side === "left" ? group.position.x : group.position.x + size.w,
				y
			};
		}
		/**
		* 节点是否交换了左右连接点（卡片右上角切换按钮，用户批注：美化布线防交叉）。
		* 交换后：出点移到左侧、入点移到右侧；节点 JSON 即事实源，swapPorts 随节点持久化。
		*/
		function swappedOf(node) {
			return (node?.data)?.swapPorts === true;
		}
		/** 连线贝塞尔几何（源端口 → 目标端口；组卡片流程接点居中，组内成员锚到成员行）。
		*  交换过连接点的节点：源出点改在左边缘（start.x=左侧），目标入点改在右边缘（end.x=右侧）。
		*  控制点方向跟随端口所在边缘（右缘向外 +x、左缘向外 -x），连线从正确一侧进出，不会
		*  穿入卡片体被遮挡（用户批注：连线方向应当根据连接点确定，而非默认朝右）。 */
		function edgeGeometry(edge, byId) {
			const source = byId.get(edge.source);
			const target = byId.get(edge.target);
			if (!source || !target) return null;
			const sourceSize = nodeSizeOf(source);
			const targetSize = nodeSizeOf(target);
			const sourceGroup = source.kind === "group" ? null : groupOfMember(byId, source.id);
			const targetGroup = target.kind === "group" ? null : groupOfMember(byId, target.id);
			const sourceSwapped = swappedOf(source);
			const targetSwapped = swappedOf(target);
			const start = sourceGroup ? memberAnchor(sourceGroup, source.id, "right") : {
				x: source.position.x + (sourceSwapped ? 0 : sourceSize.w),
				y: source.position.y + sourceSize.h * (source.kind === "group" ? .5 : handleY(edge.sourceHandle ?? "flow-out"))
			};
			const end = targetGroup ? memberAnchor(targetGroup, target.id, "left") : {
				x: target.position.x + (targetSwapped ? targetSize.w : 0),
				y: target.position.y + targetSize.h * (target.kind === "group" ? .5 : handleY(edge.targetHandle ?? "flow-in"))
			};
			const startDir = sourceGroup ? 1 : sourceSwapped ? -1 : 1;
			const endDir = targetGroup ? -1 : targetSwapped ? 1 : -1;
			const bend = Math.max(54, Math.abs(end.x - start.x) * .46);
			const c1 = {
				x: start.x + startDir * bend,
				y: start.y
			};
			const c2 = {
				x: end.x + endDir * bend,
				y: end.y
			};
			return {
				start,
				end,
				c1,
				c2,
				label: {
					x: (start.x + end.x) / 2,
					y: (start.y + end.y) / 2
				},
				path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`
			};
		}
		/** 命中检测：鼠标坐标下的节点 id（最近 data-wf-node-id 祖先）。 */
		function connectionTargetAt(clientX, clientY) {
			return document.elementFromPoint(clientX, clientY)?.closest?.("[data-wf-node-id]")?.getAttribute("data-wf-node-id") ?? null;
		}
		/**
		* 协作组表面命中（入组判定，用户批注 §4.2.5.2 收紧：仅组卡片表面可入组）：
		*  - 跳过不在协作组内的元素（画布空白/连线 SVG/其他节点等装饰层）；
		*  - 跳过被拖拽本体节点（拖拽时节点被挪到鼠标下方，若不排除会遮蔽组表面命中）；
		*  - 命中 `.wf-graph__handle`（连接点）→ 返回 null：连接点**不具入组功能**。
		* 返回命中的协作组 id；否则 null。纯函数接收元素数组，便于 jsdom 单测。
		*/
		function groupSurfaceFromElements(elements, excludeNodeId) {
			for (const el of elements) {
				const groupEl = el.closest?.(".wf-group-node");
				if (!groupEl) continue;
				const hostNodeId = el.closest?.("[data-wf-node-id]")?.getAttribute("data-wf-node-id") ?? null;
				if (excludeNodeId && hostNodeId === excludeNodeId) continue;
				if (el.closest?.(".wf-graph__handle")) return null;
				return groupEl.getAttribute("data-wf-node-id");
			}
			return null;
		}
		/** 鼠标坐标下的协作组表面（入组落点；封装 elementsFromPoint，供拖拽 onMove/onUp 共用）。 */
		function groupSurfaceUnderPoint(clientX, clientY, excludeNodeId) {
			if (typeof document.elementsFromPoint !== "function") return null;
			return groupSurfaceFromElements(document.elementsFromPoint(clientX, clientY), excludeNodeId);
		}
		//#endregion
		//#region src/client/hooks/useLibraryDrag.ts
		/** 左侧库拖拽面（canvasShellRef/canvasApiRef 供落点换算；payload 由 LeftPanel 注入）。 */
		function useLibraryDrag(canvasShellRef, canvasApiRef) {
			const dragRef = (0, react.useRef)(null);
			const [dropGroupId, setDropGroupId] = (0, react.useState)(null);
			const beginLibraryDrag = (0, react.useCallback)((event, payload) => {
				if (event.button !== void 0 && event.button !== 0) return;
				dragRef.current = {
					payload,
					startX: event.clientX,
					startY: event.clientY,
					preview: null
				};
				let lastClient = null;
				const onMove = (moveEvent) => {
					const drag = dragRef.current;
					if (!drag) return;
					lastClient = {
						x: moveEvent.clientX,
						y: moveEvent.clientY
					};
					if (!drag.preview && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) > 5) {
						drag.preview = {
							x: moveEvent.clientX,
							y: moveEvent.clientY
						};
						setDragPreview({
							x: moveEvent.clientX,
							y: moveEvent.clientY,
							label: payload.label
						});
					} else if (drag.preview) {
						drag.preview = {
							x: moveEvent.clientX,
							y: moveEvent.clientY
						};
						setDragPreview({
							x: moveEvent.clientX,
							y: moveEvent.clientY,
							label: payload.label
						});
					}
					setDropGroupId(payload.onDropIntoGroup ? groupSurfaceUnderPoint(moveEvent.clientX, moveEvent.clientY) : null);
				};
				const onUp = () => {
					const drag = dragRef.current;
					dragRef.current = null;
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					window.removeEventListener("blur", onUp);
					setDragPreview(null);
					setDropGroupId(null);
					if (!drag?.preview) {
						payload.onClick?.();
						return;
					}
					if (!lastClient) return;
					const rect = canvasShellRef.current?.getBoundingClientRect();
					if (!rect || lastClient.x < rect.left || lastClient.x > rect.right || lastClient.y < rect.top || lastClient.y > rect.bottom) return;
					const groupId = groupSurfaceUnderPoint(lastClient.x, lastClient.y) ?? "";
					if (groupId && payload.onDropIntoGroup) {
						payload.onDropIntoGroup(groupId);
						return;
					}
					const position = canvasApiRef.current?.screenToWorld?.(lastClient.x, lastClient.y);
					payload.onDrop?.({
						x: Math.round((position?.x ?? 120) - 104),
						y: Math.round((position?.y ?? 80) - 58)
					});
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				window.addEventListener("blur", onUp);
			}, []);
			const [dragPreview, setDragPreview] = (0, react.useState)(null);
			return {
				beginLibraryDrag,
				dragPreview,
				dropGroupId
			};
		}
		//#endregion
		//#region src/client/hooks/useStudioBoot.ts
		/** 初始化加载（工作台全局化：挂载时执行一次；列表为全量跨会话）。 */
		function useStudioBoot(state, dispatch, _notify, toastError, _t, remote, workflows, flowTemplates, templates, serviceControl, pickInitialInstance) {
			const stateRef = (0, react.useRef)(state);
			stateRef.current = state;
			(0, react.useEffect)(() => {
				let cancelled = false;
				const bootedSessionId = () => stateRef.current.sessionId;
				let loadedWorkflows = [];
				let loadedServices = [];
				const boot = async () => {
					try {
						const [flows, , services] = await Promise.all([
							workflows.loadWorkflows(),
							flowTemplates.loadFlowTemplates(),
							serviceControl.loadServices()
						]);
						loadedWorkflows = flows ?? [];
						loadedServices = services ?? [];
					} catch (error) {
						if (!cancelled) toastError(error);
					}
					try {
						if (!((await templates.loadTemplates()).role ?? []).some((item) => item.kind === "parent")) {
							await templates.saveTemplate("role", {
								id: "role-parent-builtin",
								kind: "parent",
								name: "父代理",
								systemPrompt: "你是工作流编排的父代理，仅负责调度子代理、判断流程走向，不执行节点任务。",
								provider: "",
								model: "",
								presetId: "standard",
								retryLimit: 3,
								reactLimit: null,
								inputSchema: "",
								outputSchema: ""
							});
							if (cancelled) return;
							await templates.loadTemplates();
						}
					} catch (error) {
						if (!cancelled) toastError(error);
					}
					const enums = async () => {
						const [presets, tools, models, combos] = await Promise.all([
							remote.call(EP_PRESETS).catch(() => []),
							remote.call(EP_TOOLS).catch(() => []),
							remote.call(EP_MODELS).catch(() => []),
							remote.call(EP_TOOL_COMBOS).catch(() => [])
						]);
						if (cancelled) return;
						dispatch({
							type: "PRESETS_LOADED",
							items: Array.isArray(presets) ? presets : []
						});
						dispatch({
							type: "TOOLS_LOADED",
							items: Array.isArray(tools) ? tools : []
						});
						dispatch({
							type: "MODELS_LOADED",
							items: Array.isArray(models) ? models : []
						});
						dispatch({
							type: "COMBOS_LOADED",
							items: Array.isArray(combos) ? combos : []
						});
					};
					await enums();
					let activeRuns = [];
					try {
						const items = await remote.call(EP_ACTIVE_RUNS, {});
						activeRuns = Array.isArray(items) ? items : [];
						if (!cancelled) dispatch({
							type: "ACTIVE_RUNS_LOADED",
							items: activeRuns
						});
					} catch {}
					const currentSessionId = bootedSessionId();
					if (cancelled || !currentSessionId) return;
					if (stateRef.current.mode === "mode1") {
						const currentSessionFlows = loadedWorkflows.filter((f) => f.sessionId === currentSessionId);
						if (currentSessionFlows.length === 0) return;
						const targetId = pickInitialInstance(currentSessionFlows, activeRuns);
						if (targetId) {
							const target = currentSessionFlows.find((f) => f.id === targetId);
							if (target) dispatch({
								type: "OPEN_FLOW",
								flow: target
							});
							const active = activeRuns.find((a) => a.flowId === targetId && a.sessionId === currentSessionId);
							if (active?.runId) dispatch({
								type: "RUN_STARTED",
								runId: active.runId,
								runSessionId: active.sessionId
							});
						}
					} else {
						const currentSessionServices = loadedServices.filter((s) => s.sessionId === currentSessionId);
						if (currentSessionServices.length === 0) return;
						const targetId = pickInitialInstance(currentSessionServices, activeRuns);
						if (targetId) {
							const target = currentSessionServices.find((s) => s.id === targetId);
							if (target) dispatch({
								type: "OPEN_SERVICE",
								service: target
							});
							const active = activeRuns.find((a) => a.flowId === targetId && a.sessionId === currentSessionId);
							if (active?.runId) dispatch({
								type: "RUN_STARTED",
								runId: active.runId,
								runSessionId: active.sessionId
							});
						}
					}
				};
				boot();
				return () => {
					cancelled = true;
				};
			}, []);
		}
		/**
		* 进入工作台自动选中实例（工作台全局化改版）：从**当前主会话**的实例列表中
		* 选出默认打开的实例 id。规则（优先级）：
		*   1. 正在运行的实例——activeRuns 中 status='running' 且归属当前会话的 flowId；
		*   2. 已暂停的实例——status='paused' 的当前会话实例；
		*   3. 实例列表第一个（后端按 updatedAt 倒序 = 最新）；
		* 校验：activeRuns 的 flowId 必须在该实例列表中（否则忽略该条目）；
		* 当前会话无实例时由调用方提前 return（保持空白画布），本函数入参即已过滤后
		* 的当前会话实例列表。
		*/
		function pickInitialInstanceForSession(currentSessionInstances, activeRuns) {
			if (!currentSessionInstances || currentSessionInstances.length === 0) return null;
			const idSet = new Set(currentSessionInstances.map((item) => item.id));
			const running = activeRuns.find((run) => run.status === "running" && idSet.has(run.flowId));
			if (running) return running.flowId;
			const paused = activeRuns.find((run) => run.status === "paused" && idSet.has(run.flowId));
			if (paused) return paused.flowId;
			return currentSessionInstances[0].id;
		}
		//#endregion
		//#region src/client/hooks/useKeyShortcuts.ts
		/** 键盘快捷键监听（window 级；卸载时移除）。 */
		function useKeyShortcuts(state, dispatch, selection, history, removeLine, removeSelected) {
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						if (state.confirm) dispatch({
							type: "CONFIRM_SET",
							confirm: null
						});
						else selection.clearSelection();
						return;
					}
					const target = event.target;
					if (!!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
					if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
						event.preventDefault();
						if (event.shiftKey) history.redo();
						else history.undo();
					} else if (event.key === "Delete" || event.key === "Backspace") {
						if (state.selection.edgeId) {
							event.preventDefault();
							removeLine(state.selection.edgeId);
						} else if (state.selection.nodeId) {
							event.preventDefault();
							removeSelected();
						}
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [
				dispatch,
				history,
				removeLine,
				removeSelected,
				selection,
				state.confirm,
				state.selection
			]);
		}
		//#endregion
		//#region src/client/components/canvas/FlowNode.tsx
		/**
		* 连接点（按模式裁剪：输入/输出节点仅保留流程连接点，用户验收标注「应当只有一个」；
		* 支持交换：swapped 时出点放左侧、入点放右侧，顺序由 handleY 决定，与批注一致）。
		*/
		function nodeHandles(kind, mode, swapped) {
			const def = HANDLES[kind] ?? HANDLES.agent;
			if (kind === "start") return {
				left: [],
				right: ["flow-out"]
			};
			if (kind === "end") return {
				left: ["flow-in"],
				right: []
			};
			const inputs = (def.inputs ?? []).filter((handle) => !(mode === "mode1" && kind === "end" && handle === "ctx-in"));
			const outputs = (def.outputs ?? []).filter((handle) => !(mode === "mode1" && kind === "start" && handle === "ctx-out"));
			return {
				left: swapped ? [...outputs].reverse() : [...inputs].reverse(),
				right: swapped ? [...inputs].reverse() : [...outputs].reverse()
			};
		}
		/** 截断文本（按字符数；中文友好）。 */
		function clip(text, limit) {
			const value = String(text ?? "");
			return value.length > limit ? `${value.slice(0, limit)}…` : value;
		}
		/** 节点元信息行（每行独立渲染；用户验收：角色卡为「模型 / 组合」两行）。 */
		function metaLinesOf(node, copy) {
			const kind = node.kind;
			const data = node.data;
			const out = [];
			if (kind === "proxy") return out;
			if (kind === "parent" || kind === "agent") {
				const modelLabel = String(copy.nodeMetaModel ?? "模型");
				const presetLabel = String(copy.nodeMetaPreset ?? "组合");
				out.push(`${modelLabel}：${String(data.model ?? "").trim() || "—"}`);
				out.push(`${presetLabel}：${copy.modeName(data.presetId ?? null)}`);
			} else if (kind === "file") {
				const fileKind = String(data.fileKind ?? "text");
				const files = data.files ?? [];
				if (fileKind === "text") {
					const content = clip(String(data.content ?? ""), 56);
					if (content.trim()) out.push(content);
				} else {
					const names = files.length > 0 ? files.map((item) => String(item?.fileName ?? "")).filter(Boolean) : [String(data.fileName ?? "")].filter(Boolean);
					if (names.length > 0) out.push(clip(names.join("，"), 40));
				}
			} else if (kind === "database") {
				out.push(data.dbType === "server" ? `${String(data.dbKind ?? "mysql")} · ${String(copy.dbTypeServer ?? "服务器")}` : String(copy.dbLocalLabel ?? "本地库"));
				if (data.vectorSource === "bm25") out.push(String(copy.dbBm25Badge ?? "相似度检索（非语义）"));
			}
			return out.filter((line) => String(line ?? "").trim());
		}
		function FlowNode({ node, copy, mode, selected, highlighted, dragging, runStatus, onPointerDown, onHandlePointerDown, onToggleSwap }) {
			const kind = node.kind;
			const isProxy = kind === "proxy";
			const isStage = kind === "start" || kind === "end" || kind === "pause";
			const swapped = node.data.swapPorts === true;
			const displayKind = isProxy ? "agent" : kind;
			const handles = nodeHandles(displayKind, mode, swapped);
			const status = runStatus?.status ?? null;
			const statusText = status ? String(copy.status[status] ?? "") : "";
			const metaLines = metaLinesOf(node, copy);
			const metaText = metaLines.join("\n");
			const size = nodeSizeOf(node);
			const cls = [
				"wf-node",
				`wf-node--${displayKind}`,
				selected ? "is-selected" : "",
				highlighted ? "is-highlighted" : "",
				isProxy ? "is-proxy" : ""
			].filter(Boolean).join(" ");
			const handleEl = (handle, side) => {
				const dir = handle.endsWith("-out") ? "out" : "in";
				const style = { top: `${handleY(handle) * 100}%` };
				if (side === "left") style.left = -6;
				else style.right = -6;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: `wf-graph__handle is-side-${side} is-${dir}`,
					style,
					"data-handle": handle,
					title: handle,
					onPointerDown: (event) => onHandlePointerDown(event, node.id, handle)
				}, handle);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `wf-graph__node${dragging ? " is-dragging" : ""}`,
				"data-wf-node-id": node.id,
				style: {
					left: node.position.x,
					top: node.position.y,
					width: size.w,
					height: size.h
				},
				onPointerDown: (event) => onPointerDown(event, node.id),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: cls,
					children: [
						!isStage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `wf-node__swap${swapped ? " is-active" : ""}`,
							title: String(copy.swapPorts ?? "交换左右连接点"),
							"aria-label": String(copy.swapPorts ?? "交换左右连接点"),
							onPointerDown: (event) => event.stopPropagation(),
							onClick: (event) => {
								event.stopPropagation();
								onToggleSwap(node.id);
							},
							children: swapped ? "⇆" : "⇄"
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-node__kind",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: String(copy.nodeKinds?.[displayKind] ?? displayKind) }),
								statusText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `wf-status-dot is-${status}` }) : null,
								statusText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-hint",
									children: statusText
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-node__label",
							children: [isProxy ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-node__proxy-badge",
								children: "↻ 引用"
							}) : null, String(node.data.label ?? copy.nodeKinds?.[displayKind] ?? "")]
						}),
						metaLines.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-node__prompt",
							children: metaText
						}) : null,
						handles.left.map((handle) => handleEl(handle, "left")),
						handles.right.map((handle) => handleEl(handle, "right"))
					]
				})
			});
		}
		//#endregion
		//#region src/client/components/canvas/GroupCard.tsx
		function GroupCard({ node, copy, members, selected, dropTarget, onPointerDown, onHandlePointerDown, onMemberSelect, onResizeStart }) {
			const size = nodeSizeOf(node);
			const memberIds = [...new Set(node.data.memberIds ?? [])];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `wf-graph__node wf-group-node${dropTarget ? " is-drop-target" : ""}`,
				"data-wf-node-id": node.id,
				style: {
					left: node.position.x,
					top: node.position.y,
					width: size.w,
					height: size.h
				},
				onPointerDown: (event) => onPointerDown(event, node.id),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `wf-node wf-node--group${selected ? " is-selected" : ""}${dropTarget ? " is-drop-target" : ""}`,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-node__kind",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: String(copy.nodeKinds?.group ?? "协作组") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-hint",
								children: `${memberIds.length} ${String(copy.groupMembers ?? "个成员")}`
							})]
						}),
						dropTarget ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-group__drop-hint",
							children: String(copy.groupDropHint ?? "放开以入组")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-node__label",
							children: String(node.data.label ?? copy.nodeKinds?.group ?? "协作组")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-group__members",
							children: members.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wf-hint",
								children: String(copy.groupMemberHint ?? "把角色拖入组内")
							}) : members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "wf-group__member",
								"data-wf-node-id": member.id,
								onPointerDown: (event) => {
									event.stopPropagation();
								},
								onClick: (event) => {
									event.stopPropagation();
									onMemberSelect(member.id);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-group__member-name",
										children: member.label || member.id
									}),
									member.status ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "wf-group__member-status",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `wf-status-dot is-${member.status}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: String(copy.status[member.status] ?? "")
										})]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-graph__handle wf-graph__handle--target wf-graph__handle--mini",
										style: { top: "30%" },
										"data-handle": "db-in",
										title: "db-in",
										onPointerDown: (event) => {
											event.stopPropagation();
											onHandlePointerDown(event, member.id, "db-in");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-graph__handle wf-graph__handle--target wf-graph__handle--mini",
										style: { top: "64%" },
										"data-handle": "ctx-in",
										title: "ctx-in",
										onPointerDown: (event) => {
											event.stopPropagation();
											onHandlePointerDown(event, member.id, "ctx-in");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-graph__handle wf-graph__handle--source wf-graph__handle--mini",
										style: { top: "47%" },
										"data-handle": "ctx-out",
										title: "ctx-out",
										onPointerDown: (event) => {
											event.stopPropagation();
											onHandlePointerDown(event, member.id, "ctx-out");
										}
									})
								]
							}, member.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-graph__handle wf-graph__handle--target",
							style: { top: "50%" },
							"data-handle": "flow-in",
							title: "flow-in",
							onPointerDown: (event) => onHandlePointerDown(event, node.id, "flow-in")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-graph__handle wf-graph__handle--source",
							style: { top: "50%" },
							"data-handle": "flow-out",
							title: "flow-out",
							onPointerDown: (event) => onHandlePointerDown(event, node.id, "flow-out")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-group__resize is-se",
							onPointerDown: (event) => onResizeStart(event, node.id, "se")
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/components/canvas/GraphCanvas.tsx
		function GraphCanvas(props) {
			const { nodes, edges, copy, mode, selectedNode, selectedEdge, runStatusByNode, highlightedNodeIds, onInit, onNodeDragStart, onNodeMove, onNodeDropToGroup, onNodeSelect, onEdgeSelect, onPaneClick, onConnect, onConnectionRejected, onGroupResize, onSwapPorts, dropTargetGroupId, fitLabel, zoomInLabel, zoomOutLabel, emptyHint, workflowCaption } = props;
			const rootRef = (0, react.useRef)(null);
			const viewportRef = (0, react.useRef)({
				x: 32,
				y: 32,
				zoom: .8
			});
			const [viewport, setViewport] = (0, react.useState)({
				x: 32,
				y: 32,
				zoom: .8
			});
			const [panning, setPanning] = (0, react.useState)(null);
			const [draggingNode, setDraggingNode] = (0, react.useState)(null);
			/** 画布内节点拖拽时悬停的协作组 id（组卡片高亮 + 「放开以入组」提示）。 */
			const [dragHoverGroupId, setDragHoverGroupId] = (0, react.useState)(null);
			const [connectionDraft, setConnectionDraft] = (0, react.useState)(null);
			const byId = (0, react.useMemo)(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
			const highlightedSet = (0, react.useMemo)(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
			const runStatusOf = (id) => runStatusByNode[id] ?? null;
			const updateViewport = (0, react.useCallback)((value) => {
				setViewport((current) => {
					const next = typeof value === "function" ? value(current) : value;
					viewportRef.current = next;
					return next;
				});
			}, []);
			const fitView = (0, react.useCallback)((options = {}) => {
				const root = rootRef.current;
				if (!root || nodes.length === 0) return;
				const rect = root.getBoundingClientRect();
				if (!rect.width || !rect.height) return;
				const requestedIds = new Set((options.nodes ?? []).map((node) => typeof node === "string" ? node : node.id).filter(Boolean));
				const visibleNodes = requestedIds.size > 0 ? nodes.filter((node) => requestedIds.has(node.id)) : nodes;
				if (visibleNodes.length === 0) return;
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (const node of visibleNodes) {
					const size = nodeSizeOf(node);
					minX = Math.min(minX, node.position.x);
					minY = Math.min(minY, node.position.y);
					maxX = Math.max(maxX, node.position.x + size.w);
					maxY = Math.max(maxY, node.position.y + size.h);
				}
				const padding = Math.max(36, Math.min(rect.width, rect.height) * Number(options.padding ?? .16));
				const zoom = clamp(Math.min((rect.width - padding * 2) / Math.max(1, maxX - minX), (rect.height - padding * 2) / Math.max(1, maxY - minY)), GRAPH_MIN_ZOOM, 1.15);
				updateViewport({
					x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
					y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
					zoom
				});
			}, [nodes, updateViewport]);
			const focusNode = (0, react.useCallback)((id, options = {}) => {
				const root = rootRef.current;
				const node = nodes.find((candidate) => candidate.id === id);
				if (!root || !node) return;
				const rect = root.getBoundingClientRect();
				const zoom = clamp(Number(options.zoom ?? Math.max(viewportRef.current.zoom, .96)), GRAPH_MIN_ZOOM, 1.15);
				updateViewport({
					x: rect.width / 2 - (node.position.x + GRAPH_NODE_SIZE.w / 2) * zoom,
					y: rect.height / 2 - (node.position.y + GRAPH_NODE_SIZE.h / 2) * zoom,
					zoom
				});
			}, [nodes, updateViewport]);
			const zoomBy = (0, react.useCallback)((factor) => {
				const root = rootRef.current;
				if (!root) return;
				const rect = root.getBoundingClientRect();
				const cx = rect.width / 2;
				const cy = rect.height / 2;
				const current = viewportRef.current;
				const zoom = clamp(current.zoom * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
				const ratio = zoom / current.zoom;
				updateViewport({
					zoom,
					x: cx - (cx - current.x) * ratio,
					y: cy - (cy - current.y) * ratio
				});
			}, [updateViewport]);
			const screenToWorld = (0, react.useCallback)((clientX, clientY) => {
				const rect = rootRef.current?.getBoundingClientRect();
				if (!rect) return {
					x: 0,
					y: 0
				};
				return {
					x: (clientX - rect.left - viewportRef.current.x) / viewportRef.current.zoom,
					y: (clientY - rect.top - viewportRef.current.y) / viewportRef.current.zoom
				};
			}, []);
			(0, react.useEffect)(() => {
				onInit({
					fitView,
					focusNode,
					zoomIn: () => zoomBy(1.2),
					zoomOut: () => zoomBy(1 / 1.2),
					screenToWorld
				});
			}, [
				onInit,
				fitView,
				focusNode,
				zoomBy,
				screenToWorld
			]);
			const beginPan = (0, react.useCallback)((event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				setPanning({
					startX: event.clientX,
					startY: event.clientY,
					originX: viewportRef.current.x,
					originY: viewportRef.current.y
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!panning) return void 0;
				const onMove = (event) => {
					updateViewport({
						...viewportRef.current,
						x: panning.originX + (event.clientX - panning.startX),
						y: panning.originY + (event.clientY - panning.startY)
					});
				};
				const onUp = () => setPanning(null);
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
				};
			}, [panning, updateViewport]);
			const beginNodeDrag = (0, react.useCallback)((event, nodeId) => {
				if (event.button !== void 0 && event.button !== 0) return;
				const target = event.target;
				if (target.closest?.(".wf-graph__handle")) return;
				if (target.closest?.(".wf-group__resize")) return;
				event.stopPropagation();
				const node = byId.get(nodeId);
				if (!node) return;
				onNodeSelect?.(nodeId);
				onNodeDragStart?.();
				setDragHoverGroupId(null);
				setDraggingNode({
					nodeId,
					startClientX: event.clientX,
					startClientY: event.clientY,
					originX: node.position.x,
					originY: node.position.y
				});
			}, [
				byId,
				onNodeSelect,
				onNodeDragStart
			]);
			(0, react.useEffect)(() => {
				if (!draggingNode) return void 0;
				const onMove = (event) => {
					const current = viewportRef.current;
					const dx = (event.clientX - draggingNode.startClientX) / current.zoom;
					const dy = (event.clientY - draggingNode.startClientY) / current.zoom;
					onNodeMove?.(draggingNode.nodeId, {
						x: Math.round(draggingNode.originX + dx),
						y: Math.round(draggingNode.originY + dy)
					});
					const dragged = byId.get(draggingNode.nodeId);
					const canJoinGroup = !!dragged && (dragged.kind === "parent" || dragged.kind === "agent");
					setDragHoverGroupId(canJoinGroup ? groupSurfaceUnderPoint(event.clientX, event.clientY, draggingNode.nodeId) : null);
				};
				const onUp = (event) => {
					const node = byId.get(draggingNode.nodeId);
					const groupId = groupSurfaceUnderPoint(event.clientX, event.clientY, draggingNode.nodeId);
					if (node && (node.kind === "parent" || node.kind === "agent") && groupId && groupId !== node.id && !(node.data.groupId ?? null)) {
						onNodeDropToGroup?.(node.id, groupId);
						setDraggingNode(null);
						setDragHoverGroupId(null);
						return;
					}
					setDraggingNode(null);
					setDragHoverGroupId(null);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
				};
			}, [
				draggingNode,
				byId,
				onNodeMove,
				onNodeDropToGroup,
				setDragHoverGroupId
			]);
			const beginConnection = (0, react.useCallback)((event, nodeId, handle) => {
				if (event.button !== void 0 && event.button !== 0) return;
				if (!handle.endsWith("-out")) return;
				event.stopPropagation();
				if (!byId.get(nodeId)) return;
				const start = screenToWorld(event.clientX, event.clientY);
				setConnectionDraft({
					source: nodeId,
					sourceHandle: handle,
					clientX: event.clientX,
					clientY: event.clientY,
					start
				});
			}, [byId, screenToWorld]);
			(0, react.useEffect)(() => {
				if (!connectionDraft) return void 0;
				const onMove = (event) => {
					setConnectionDraft((draft) => draft ? {
						...draft,
						clientX: event.clientX,
						clientY: event.clientY
					} : draft);
				};
				const onUp = (event) => {
					const targetId = connectionTargetAt(event.clientX, event.clientY);
					const targetHandle = `${connectionDraft.sourceHandle.replace(/-out$/, "")}-in`;
					if (targetId && targetId !== connectionDraft.source) onConnect?.({
						source: connectionDraft.source,
						target: targetId,
						sourceHandle: connectionDraft.sourceHandle,
						targetHandle
					});
					else onConnectionRejected?.();
					setConnectionDraft(null);
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
				};
			}, [
				connectionDraft,
				onConnect,
				onConnectionRejected
			]);
			(0, react.useEffect)(() => {
				const root = rootRef.current;
				if (!root) return void 0;
				const onWheel = (event) => {
					event.preventDefault();
					const current = viewportRef.current;
					const rect = root.getBoundingClientRect();
					const mx = event.clientX - rect.left;
					const my = event.clientY - rect.top;
					const factor = Math.exp(-event.deltaY * .0012);
					const zoom = clamp(current.zoom * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
					const ratio = zoom / current.zoom;
					updateViewport({
						zoom,
						x: mx - (mx - current.x) * ratio,
						y: my - (my - current.y) * ratio
					});
				};
				root.addEventListener("wheel", onWheel, { passive: false });
				return () => root.removeEventListener("wheel", onWheel);
			}, [updateViewport]);
			const [groupResize, setGroupResize] = (0, react.useState)(null);
			const beginGroupResize = (0, react.useCallback)((event, nodeId) => {
				if (event.button !== void 0 && event.button !== 0) return;
				event.stopPropagation();
				const node = byId.get(nodeId);
				if (!node) return;
				setGroupResize({
					nodeId,
					startX: event.clientX,
					startY: event.clientY,
					startSize: nodeSizeOf(node)
				});
			}, [byId]);
			(0, react.useEffect)(() => {
				if (!groupResize) return void 0;
				const onMove = (moveEvent) => {
					const dx = moveEvent.clientX - groupResize.startX;
					const dy = moveEvent.clientY - groupResize.startY;
					const nextW = Math.max(240, groupResize.startSize.w + dx);
					const nextH = Math.max(150, groupResize.startSize.h + dy);
					onGroupResize?.(groupResize.nodeId, {
						w: Math.round(nextW),
						h: Math.round(nextH)
					});
				};
				const onUp = () => setGroupResize(null);
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				window.addEventListener("blur", onUp);
				return () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					window.removeEventListener("blur", onUp);
				};
			}, [groupResize, onGroupResize]);
			const edgeViews = nodes.length === 0 ? [] : edges.map((edge) => {
				const geometry = edgeGeometry(edge, byId);
				if (!geometry) return null;
				const isSelected = edge.id === selectedEdge;
				const isRunning = runStatusOf(edge.source)?.status === "running";
				const lineType = conditionLabel(edge.condition) ? edgeConditionClass(edge) : edgeChannelClass(edge);
				const label = conditionLabel(edge.condition);
				const channel = lineType.startsWith("is-") ? lineType.slice(3) : "";
				const markerEnd = channel === "" || channel === "pass" || channel === "fail" || channel === "content" ? `url(#wf-arrow-${channel === "" ? "flow" : channel})` : void 0;
				const labelWidth = label ? Math.min(150, Math.max(34, label.length * 7 + 16)) : 0;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						className: `wf-graph__edge-hit${isSelected ? " is-selected" : ""}`,
						d: geometry.path,
						onPointerDown: (event) => {
							event.stopPropagation();
							onEdgeSelect?.(edge.id);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						className: `wf-graph__edge${isSelected ? " is-selected" : ""}${lineType ? ` ${lineType}` : ""}${isRunning ? " is-running" : ""}`,
						d: geometry.path,
						markerEnd
					}),
					label ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						className: "wf-edge-label-group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							className: "wf-graph__label-bg",
							x: geometry.label.x - labelWidth / 2,
							y: geometry.label.y - 8,
							width: labelWidth,
							height: 16,
							rx: 8
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
							className: "wf-graph__label",
							x: geometry.label.x,
							y: geometry.label.y,
							children: label
						})]
					}) : null
				] }, edge.id);
			});
			let draftPath = null;
			if (connectionDraft) {
				const current = viewportRef.current;
				const rect = rootRef.current?.getBoundingClientRect();
				const mouseWorld = rect ? {
					x: (connectionDraft.clientX - rect.left - current.x) / current.zoom,
					y: (connectionDraft.clientY - rect.top - current.y) / current.zoom
				} : connectionDraft.start;
				const sourceNode = byId.get(connectionDraft.source);
				const draftStartDir = sourceNode ? groupOfMember(byId, sourceNode.id) ? 1 : swappedOf(sourceNode) ? -1 : 1 : 1;
				const bend = Math.max(54, Math.abs(mouseWorld.x - connectionDraft.start.x) * .46);
				draftPath = `M ${connectionDraft.start.x} ${connectionDraft.start.y} C ${connectionDraft.start.x + draftStartDir * bend} ${connectionDraft.start.y}, ${mouseWorld.x - bend} ${mouseWorld.y}, ${mouseWorld.x} ${mouseWorld.y}`;
			}
			const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
			const renderedNodes = nodes.map((node) => {
				if (node.kind !== "proxy") return node;
				const sourceId = String(node.proxySourceId ?? "");
				const main = byId.get(sourceId);
				return main ? {
					...node,
					data: {
						...node.data,
						label: String(main.data.label ?? "")
					}
				} : node;
			});
			const groupNodes = nodes.filter((node) => node.kind === "group");
			const memberIdsOf = /* @__PURE__ */ new Set();
			for (const group of groupNodes) for (const memberId of [...new Set(group.data.memberIds ?? [])]) memberIdsOf.add(memberId);
			const standalone = renderedNodes.filter((node) => node.kind !== "group" && !memberIdsOf.has(node.id));
			const groupMembers = /* @__PURE__ */ new Map();
			for (const group of groupNodes) {
				const members = [...new Set(group.data.memberIds ?? [])].map((memberId) => {
					const member = byId.get(memberId);
					return {
						id: memberId,
						label: String((member?.data)?.label ?? memberId),
						status: runStatusOf(memberId)?.status ?? null
					};
				});
				groupMembers.set(group.id, members);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wf-canvas-stage",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `wf-canvas${panning ? " is-panning" : ""}`,
					ref: rootRef,
					onPointerDown: (event) => {
						if (event.target === event.currentTarget) beginPan(event);
					},
					onClick: (event) => {
						if (event.target === event.currentTarget) onPaneClick?.();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-graph__stage",
							style: { transform },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									className: "wf-graph__edges",
									width: "100%",
									height: "100%",
									style: {
										position: "absolute",
										inset: 0,
										overflow: "visible"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
												id: "wf-arrow-flow",
												viewBox: "0 0 10 10",
												refX: "8",
												refY: "5",
												markerWidth: "7",
												markerHeight: "7",
												orient: "auto-start-reverse",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
													d: "M 0 1 L 9 5 L 0 9 z",
													className: "wf-arrow-head"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
												id: "wf-arrow-pass",
												viewBox: "0 0 10 10",
												refX: "8",
												refY: "5",
												markerWidth: "7",
												markerHeight: "7",
												orient: "auto-start-reverse",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
													d: "M 0 1 L 9 5 L 0 9 z",
													className: "wf-arrow-head is-pass"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
												id: "wf-arrow-fail",
												viewBox: "0 0 10 10",
												refX: "8",
												refY: "5",
												markerWidth: "7",
												markerHeight: "7",
												orient: "auto-start-reverse",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
													d: "M 0 1 L 9 5 L 0 9 z",
													className: "wf-arrow-head is-fail"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
												id: "wf-arrow-content",
												viewBox: "0 0 10 10",
												refX: "8",
												refY: "5",
												markerWidth: "7",
												markerHeight: "7",
												orient: "auto-start-reverse",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
													d: "M 0 1 L 9 5 L 0 9 z",
													className: "wf-arrow-head is-content"
												})
											})
										] }),
										edgeViews,
										draftPath ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											className: "wf-graph__connection",
											d: draftPath
										}) : null
									]
								}),
								groupNodes.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupCard, {
									node,
									copy,
									members: groupMembers.get(node.id) ?? [],
									selected: node.id === selectedNode,
									dropTarget: dropTargetGroupId === node.id || dragHoverGroupId === node.id,
									onPointerDown: beginNodeDrag,
									onHandlePointerDown: beginConnection,
									onMemberSelect: onNodeSelect,
									onResizeStart: beginGroupResize
								}, node.id)),
								standalone.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FlowNode, {
									node,
									copy,
									mode,
									selected: node.id === selectedNode,
									highlighted: highlightedSet.has(node.id),
									dragging: draggingNode?.nodeId === node.id,
									runStatus: node.kind === "agent" || node.kind === "parent" ? runStatusOf(node.id) : null,
									onPointerDown: beginNodeDrag,
									onHandlePointerDown: beginConnection,
									onToggleSwap: onSwapPorts
								}, node.id))
							]
						}),
						workflowCaption ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-canvas-caption",
							children: workflowCaption
						}) : null,
						nodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-canvas-empty",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-canvas-empty__hint",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wf-canvas-empty__icon",
									children: "⬡"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: emptyHint })]
							})
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-graph__controls",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => zoomBy(1.2),
							title: zoomInLabel,
							children: "+"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => fitView(),
							title: fitLabel,
							children: "⛶"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => zoomBy(1 / 1.2),
							title: zoomOutLabel,
							children: "−"
						})
					]
				})]
			});
		}
		/** 连线通道颜色 class（流程/上下文/数据库）。 */
		function edgeChannelClass(edge) {
			const sourceHandle = edge.sourceHandle ?? "";
			const targetHandle = edge.targetHandle ?? "";
			if (sourceHandle === "db-out" || targetHandle === "db-in") return "is-db";
			if (sourceHandle === "ctx-out" || targetHandle === "ctx-in") return "is-ctx";
			return "";
		}
		/** 条件连线颜色 class（通过/不通过/内容）。 */
		function edgeConditionClass(edge) {
			const type = edge.condition?.type;
			if (type === "pass") return "is-pass";
			if (type === "fail") return "is-fail";
			if (type === "content") return "is-content";
			return "";
		}
		//#endregion
		//#region src/client/components/sidebar/library-model.ts
		/** 四 Tag（与左栏一致；底栏以图标展示）。 */
		const TAB_DEFS = [
			{
				key: "workflow",
				label: "工作流",
				icon: "▦"
			},
			{
				key: "role",
				label: "角色",
				icon: "◆"
			},
			{
				key: "data",
				label: "数据",
				icon: "▤"
			},
			{
				key: "other",
				label: "其他",
				icon: "⋯"
			}
		];
		function truncate(value, limit) {
			const text = String(value ?? "").trim();
			return text.length > limit ? `${text.slice(0, limit)}…` : text || "—";
		}
		/** 角色模板卡副行：System Prompt 截断展示（需求 §4.2.3.1：不可编辑，超过 20 字截断；
		*  从 .md 加载时显示所选 .md 文件名——用户验收标注）。 */
		function roleSubline(template) {
			const source = String(template.systemPromptSource ?? "").trim();
			if (source) return source;
			return truncate(String(template.systemPrompt ?? ""), 20);
		}
		/** 文件模板卡副行：文本类型显示内容（单行省略）；文件类型显示所选文件名列表
		*  （保留中文文件名；超出单行省略）——用户验收标注。 */
		function fileSubline(template) {
			if (template.fileKind === "file") return truncate((Array.isArray(template.files) && template.files.length > 0 ? template.files.map((item) => String(item?.fileName ?? "")).filter(Boolean) : [String(template.fileName ?? "")].filter(Boolean)).join("，"), 60);
			return truncate(String(template.content ?? ""), 60);
		}
		/** 构造库内容模型（纯函数；不渲染，不读 DOM/时钟）。 */
		function buildLibraryModel(input) {
			const { copy: t, libTab, workflows, currentSessionId, flowTemplates, parentTemplate, roleTemplates, fileTemplates, databaseTemplates, groupTemplates, stageKinds, libSelection, onSelectWorkflow, onSelectFlowTemplate, onSelectLib, onPlaceTemplate, onPlaceTemplateIntoGroup, onPlaceStage, onPlaceGroupFromTemplate, onPlaceParent, onCreateNew } = input;
			const isActive = (kind, id) => libSelection?.kind === kind && libSelection?.id === id;
			function card(key, kind, id, icon, name, sub, payload, pinned = false, runStatus, isCurrent = false) {
				return {
					key,
					kind,
					id,
					icon,
					name,
					sub,
					pinned,
					runStatus,
					isCurrent,
					active: isActive(kind, id),
					payload
				};
			}
			const sections = [];
			if (libTab === "workflow") {
				sections.push({
					key: "instances",
					title: t.flowInstances,
					plus: false,
					cards: (workflows ?? []).map((item) => card(item.id, "workflow", item.id, "▦", String(item.name ?? ""), item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes ?? ""}`, {
						label: String(item.name ?? ""),
						onClick: () => onSelectWorkflow(item.id),
						onDrop: () => onSelectWorkflow(item.id)
					}, false, item.runStatus, item.sessionId === currentSessionId))
				});
				sections.push({
					key: "flowTemplates",
					title: t.flowTemplates,
					plus: true,
					plusKind: "flowTemplate",
					cards: (flowTemplates ?? []).map((item) => card(item.id, "workflowTemplate", item.id, "▦", String(item.name ?? ""), item.description ? truncate(item.description, 60) : `${item.nodes?.length ?? 0} ${t.nodes ?? ""}`, {
						label: String(item.name ?? ""),
						onClick: () => onSelectFlowTemplate(item.id),
						onDrop: () => onSelectFlowTemplate(item.id)
					}))
				});
			} else if (libTab === "role") {
				if (parentTemplate) sections.push({
					key: "parent",
					title: t.parentAgent,
					plus: false,
					cards: [card(parentTemplate.id, "parentTemplate", parentTemplate.id, "父", String(parentTemplate.name ?? t.parentAgent), roleSubline(parentTemplate), {
						label: String(parentTemplate.name ?? t.parentAgent),
						onClick: () => onSelectLib("parentTemplate", parentTemplate.id),
						onDrop: (position) => onPlaceParent(parentTemplate.id, position ?? {
							x: 120,
							y: 80
						})
					}, true)]
				});
				sections.push({
					key: "roles",
					title: t.roleTemplates,
					plus: true,
					cards: (roleTemplates ?? []).map((item) => card(item.id, "role", item.id, "◆", String(item.name ?? ""), roleSubline(item), {
						label: String(item.name ?? ""),
						onClick: () => onSelectLib("role", item.id),
						onDrop: (position) => onPlaceTemplate("role", item.id, position ?? {
							x: 120,
							y: 80
						}),
						onDropIntoGroup: (groupId, position) => onPlaceTemplateIntoGroup("role", item.id, groupId, position ?? {
							x: 120,
							y: 80
						})
					}))
				});
			} else if (libTab === "data") {
				sections.push({
					key: "files",
					title: t.files,
					plus: true,
					plusKind: "file",
					cards: (fileTemplates ?? []).map((item) => card(item.id, "file", item.id, "▤", String(item.name ?? ""), fileSubline(item), {
						label: String(item.name ?? ""),
						onClick: () => onSelectLib("file", item.id),
						onDrop: (position) => onPlaceTemplate("file", item.id, position ?? {
							x: 120,
							y: 80
						})
					}))
				});
				sections.push({
					key: "databases",
					title: t.databases,
					plus: true,
					plusKind: "database",
					cards: (databaseTemplates ?? []).map((item) => card(item.id, "database", item.id, "▦", String(item.name ?? ""), truncate(String(item.description ?? ""), 60), {
						label: String(item.name ?? ""),
						onClick: () => onSelectLib("database", item.id),
						onDrop: (position) => onPlaceTemplate("database", item.id, position ?? {
							x: 120,
							y: 80
						})
					}))
				});
			} else {
				sections.push({
					key: "stages",
					title: t.stages,
					plus: false,
					cards: (stageKinds ?? []).map((card0) => card(card0.kind, "stage", card0.kind, "⬢", String(card0.label), String(t.stagePinHint ?? ""), {
						label: String(card0.label),
						onClick: () => onSelectLib("stage", card0.kind),
						onDrop: (position) => onPlaceStage(card0.kind, position ?? {
							x: 120,
							y: 80
						})
					}))
				});
				sections.push({
					key: "groups",
					title: t.groupTemplates,
					plus: true,
					plusKind: "group",
					cards: (groupTemplates ?? []).map((item) => card(item.id, "groupTemplate", item.id, "☰", String(item.name ?? ""), truncate(String(item.collabPrompt ?? ""), 60), {
						label: String(item.name ?? ""),
						onClick: () => onSelectLib("groupTemplate", item.id),
						onDrop: (position) => onPlaceGroupFromTemplate(item.id, position ?? {
							x: 120,
							y: 80
						})
					}))
				});
			}
			return {
				tabs: TAB_DEFS.map((def) => ({
					...def,
					label: t.libTab[def.key] ?? def.label
				})),
				sections
			};
		}
		//#endregion
		//#region src/client/components/sidebar/LeftPanel.tsx
		function LeftPanel(props) {
			const { copy: t, libTab, onSetTab, open, width, onCreateNew, onBeginDrag } = props;
			const model = buildLibraryModel(props);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: `wf-docrail${open ? "" : " is-collapsed"}`,
				style: { width: open ? width : void 0 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-lib-tabs",
					role: "tablist",
					children: model.tabs.map((def) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						title: def.label,
						"aria-label": def.label,
						className: `wf-lib-tab${libTab === def.key ? " is-active" : ""}`,
						onClick: () => onSetTab(def.key),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: def.label })
					}, def.key))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-docrail__list",
					children: model.sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-docgroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: section.title }), section.plus ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "wf-docgroup__add",
							title: t.newTemplate,
							onClick: () => onCreateNew(libTab, section.plusKind),
							children: "＋"
						}) : null]
					}), section.cards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-hint",
						style: { padding: "2px 8px" },
						children: t.libEmptyTemplates
					}) : section.cards.map((item) => {
						const statusText = item.runStatus ? String(t.status[item.runStatus] ?? "") : "";
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: `wf-docitem${item.pinned ? " is-pinned" : ""}${item.active ? " is-active" : ""}`,
							onPointerDown: (event) => onBeginDrag(event, item.payload),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-docitem__icon",
									children: item.icon
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "wf-docitem__texts",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "wf-docitem__title-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-docitem__label",
											children: item.name
										}), item.isCurrent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-docitem__badge is-current",
											children: t.currentSessionBadge
										}) : null]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-docitem__path",
										children: item.sub
									})]
								}),
								statusText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-docitem__badge",
									children: statusText
								}) : null
							]
						}, item.key);
					})] }, section.key))
				})]
			});
		}
		//#endregion
		//#region src/client/components/sidebar/BottomPanel.tsx
		function BottomPanel(props) {
			const { copy: t, libTab, onSetTab, open, height, onCreateNew, onBeginDrag } = props;
			const model = buildLibraryModel(props);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: `wf-bottombar${open ? "" : " is-collapsed"}`,
				style: { height: open ? height : void 0 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-bottombar__tags",
					role: "tablist",
					children: model.tabs.map((def) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						title: def.label,
						"aria-label": def.label,
						className: `wf-bottombar__tag${libTab === def.key ? " is-active" : ""}`,
						onClick: () => onSetTab(def.key),
						children: def.label
					}, def.key))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-bottombar__scroll",
					children: model.sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-bottombar__section",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-bottombar__group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-bottombar__group-title",
								children: section.title
							}), section.plus ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-docgroup__add",
								title: t.newTemplate,
								onClick: () => onCreateNew(libTab, section.plusKind),
								children: "＋"
							}) : null]
						}), section.cards.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-hint",
							children: t.libEmptyTemplates
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-bottombar__cards",
							children: section.cards.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `wf-hcard${item.active ? " is-active" : ""}`,
								onPointerDown: (event) => onBeginDrag(event, item.payload),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-hcard__name",
									children: item.name
								})
							}, item.key))
						})]
					}, section.key))
				})]
			});
		}
		//#endregion
		//#region src/client/components/toolbar/Toolbar.tsx
		function Toolbar(props) {
			const { copy: t, mode, panelsCollapsed, onTogglePanels, saveLabel, onUndo, onRedo, onClear, canClear, onTidy, canTidy, onSave, canSave, running, onStop, onRun, onOpenHistory, canHistory, serviceStatus, showNewSession, instanceOptions, onInstanceOptionsChange } = props;
			const isMode2 = mode === "mode2";
			const statusText = isMode2 && serviceStatus ? serviceStatus.status === "running" ? serviceStatus.port ? `${t.serviceRunning} · ${serviceStatus.port}` : t.serviceStarting : serviceStatus.status === "crashed" ? t.serviceCrashed : t.serviceStopped : null;
			const statusRunning = serviceStatus?.status === "running";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wf-toolbar",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `wf-btn wf-iconbtn is-ghost wf-toolbar__panels${panelsCollapsed ? " is-collapsed" : ""}`,
						title: t.togglePanels,
						"aria-label": t.togglePanels,
						onClick: onTogglePanels,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							viewBox: "0 0 24 24",
							width: "16",
							height: "16",
							"aria-hidden": "true",
							style: { color: "currentColor" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "2",
								d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "2",
								d: "M9 5v14M15 5v14"
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn wf-iconbtn is-ghost",
						title: `${t.undo} · Ctrl/Cmd+Z`,
						"aria-label": t.undo,
						onClick: onUndo,
						children: "↶"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn wf-iconbtn is-ghost",
						title: `${t.redo} · Ctrl/Cmd+Shift+Z`,
						"aria-label": t.redo,
						onClick: onRedo,
						children: "↷"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn is-ghost",
						title: t.clearCanvas,
						onClick: onClear,
						disabled: !canClear,
						children: t.clear
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn is-ghost",
						title: t.tidy,
						onClick: onTidy,
						disabled: !canTidy,
						children: t.tidy
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn",
						onClick: onSave,
						disabled: !canSave,
						children: saveLabel
					}),
					running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn is-danger",
						onClick: onStop,
						children: t.stop
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn is-primary",
						onClick: onRun,
						disabled: !canSave,
						children: isMode2 ? t.startService : t.run
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-btn is-ghost",
						onClick: onOpenHistory,
						disabled: !canHistory,
						children: t.history
					}),
					statusText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `wf-status${statusRunning ? " is-running" : ""}`,
						children: statusText
					}) : null,
					showNewSession ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "wf-toolbar__switch",
						title: t.newSessionHint,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: instanceOptions.newSession,
							onChange: (event) => onInstanceOptionsChange({ newSession: event.target.checked })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t.newSession })]
					}) : null,
					showNewSession && instanceOptions.newSession ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "text",
						className: "wf-toolbar__workspace",
						value: instanceOptions.workspacePath,
						placeholder: t.workspacePlaceholder,
						title: t.workspaceHint,
						onChange: (event) => onInstanceOptionsChange({ workspacePath: event.target.value })
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/components/panels/inspector/forms.tsx
		function Field$1({ label, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "wf-field",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: label
				}), children]
			});
		}
		function InputField({ label, value, placeholder, onChange, type = "text", step }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
				label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type,
					value: String(value ?? ""),
					placeholder,
					step,
					onChange: (event) => onChange(event.target.value)
				})
			});
		}
		function TextAreaField({ label, value, placeholder, onChange, minHeight }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
				label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
					value: String(value ?? ""),
					placeholder,
					spellCheck: false,
					style: minHeight ? { minHeight } : void 0,
					onChange: (event) => onChange(event.target.value)
				})
			});
		}
		function nameOf(data) {
			return String(data?.name ?? data?.label ?? "");
		}
		function NameField({ data, copy, onPatch }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
				label: copy.label,
				value: nameOf(data),
				onChange: (value) => onPatch({
					label: value,
					name: value
				})
			});
		}
		/** 思考强度回退档位（DeepSeek 适配器公布 off/low/high/max；适配器未提供 efforts 时使用）。 */
		const FALLBACK_EFFORTS = [
			{
				id: "off",
				name: "Off"
			},
			{
				id: "low",
				name: "Low"
			},
			{
				id: "high",
				name: "High"
			},
			{
				id: "max",
				name: "Max"
			}
		];
		function RoleForm({ data, copy, presets, models, combos, onPatch, onLoadMd, isParent = false, allowCombos = true }) {
			const providers = [...new Set(models.map((entry) => entry.provider))].filter(Boolean);
			const modelsForProvider = models.filter((entry) => entry.provider === String(data.provider ?? ""));
			const presetId = String(data.presetId ?? "standard");
			const selectedCombo = allowCombos ? combos.find((combo) => combo.id === presetId) ?? null : null;
			const toolCount = selectedCombo ? (selectedCombo.tools?.length ?? 0) + (selectedCombo.mcpServers?.length ?? 0) : null;
			const modeOptions = (presets ?? []).map((preset) => ({
				value: preset.id,
				label: preset.name ?? preset.id
			}));
			const modeGroups = allowCombos && (combos ?? []).length > 0 ? [{
				label: copy.combos,
				options: (combos ?? []).map((combo) => ({
					value: combo.id,
					label: combo.name
				}))
			}] : [];
			const hasMode = modeOptions.length > 0 || modeGroups.length > 0;
			const selectedModel = modelsForProvider.find((entry) => entry.model === String(data.model ?? ""));
			const effortOptions = selectedModel?.efforts == null ? FALLBACK_EFFORTS : selectedModel.efforts;
			const effortsKnown = selectedModel?.efforts != null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: isParent ? copy.nodeKinds.parent : copy.nodeKinds.agent }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NameField, {
					data,
					copy,
					onPatch
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.persona,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: String(data.systemPrompt ?? ""),
								placeholder: copy.personaHint,
								spellCheck: false,
								style: { minHeight: 130 },
								onChange: (event) => onPatch({ systemPrompt: event.target.value })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 6,
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wf-btn",
									title: copy.loadMdTitle,
									onClick: onLoadMd,
									children: copy.loadMd
								}), String(data.systemPromptSource ?? "").trim() ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-hint",
									title: copy.loadMdTitle,
									children: String(data.systemPromptSource)
								}) : null]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 6,
									justifyContent: "flex-start"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: data.injectSystemPrompt !== false,
									onChange: (event) => onPatch({ injectSystemPrompt: event.target.checked }),
									style: {
										width: "auto",
										flex: "0 0 auto",
										padding: 0,
										margin: 0,
										minWidth: 0,
										accentColor: "var(--wf-brand)"
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "wf-hint",
									style: { whiteSpace: "nowrap" },
									children: [
										copy.injectSystemPromptLabel,
										"：",
										data.injectSystemPrompt === false ? copy.injectSystemPromptNotInjected : copy.injectSystemPromptInjected
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 6,
									justifyContent: "flex-start"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: data.injectToolSections !== false,
									onChange: (event) => onPatch({ injectToolSections: event.target.checked }),
									style: {
										width: "auto",
										flex: "0 0 auto",
										padding: 0,
										margin: 0,
										minWidth: 0,
										accentColor: "var(--wf-brand)"
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "wf-hint",
									style: { whiteSpace: "nowrap" },
									children: [
										copy.injectToolSectionsLabel,
										"：",
										data.injectToolSections === false ? copy.injectToolSectionsNotInjected : copy.injectToolSectionsInjected
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-hint",
								children: copy.promptFilePathHint
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								value: String(data.promptFilePath ?? ""),
								placeholder: copy.promptFilePathPlaceholder,
								spellCheck: false,
								onChange: (event) => onPatch({ promptFilePath: event.target.value.trim() || void 0 })
							})
						]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 8
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
						label: copy.provider,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: String(data.provider ?? ""),
							onChange: (event) => onPatch({
								provider: event.target.value,
								model: ""
							}),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "(default)"
							}), providers.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: provider,
								children: provider
							}, provider))]
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
						label: copy.model,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: String(data.model ?? ""),
							onChange: (event) => onPatch({ model: event.target.value }),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "(default)"
							}), modelsForProvider.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: entry.model,
								children: entry.model
							}, entry.model))]
						})
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gridTemplateColumns: hasMode ? "1fr 1fr" : "1fr",
						gap: 8
					},
					children: [hasMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
						label: copy.modeLabel,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: presetId,
							disabled: isParent,
							onChange: (event) => onPatch({ presetId: event.target.value }),
							children: [modeOptions.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: option.value,
								children: option.label
							}, option.value)), modeGroups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
								label: group.label,
								children: group.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: option.value,
									children: option.label
								}, option.value))
							}, group.label))]
						})
					}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
						label: copy.thinking,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: String(data.reasoning ?? ""),
							onChange: (event) => onPatch({ reasoning: event.target.value || null }),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "(default)"
							}), effortOptions.map((effort) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: effort.id,
								children: effort.name
							}, effort.id))]
						})
					})]
				}),
				effortsKnown && effortOptions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: copy.thinkingUnsupportedHint
				}) : null,
				toolCount != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: copy.modeSummary.replace("{count}", String(toolCount))
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "wf-advanced",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: copy.advanced }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-advanced__content",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
								label: copy.retryLimit,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: 1,
									max: 20,
									value: Number(data.retryLimit ?? 3),
									onChange: (event) => onPatch({ retryLimit: Math.max(1, Math.min(20, Number(event.target.value) || 3)) })
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
								label: copy.reactLimit,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: 0,
									placeholder: copy.reactLimitHint,
									value: Number(data.reactLimit ?? 0) || "",
									onChange: (event) => onPatch({ reactLimit: Number(event.target.value) > 0 ? Number(event.target.value) : null })
								})
							})]
						}), isParent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-hint",
							children: copy.parentAdvancedHint
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextAreaField, {
							label: copy.inputSchema,
							value: data.inputSchema,
							placeholder: "如：{query: string}",
							onChange: (value) => onPatch({ inputSchema: value })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextAreaField, {
							label: copy.outputSchema,
							value: data.outputSchema,
							placeholder: "如：{result: string, pass: boolean}",
							onChange: (value) => onPatch({ outputSchema: value })
						})] })]
					})]
				})
			] });
		}
		function FileForm({ data, copy, onPatch, onFileSelect }) {
			const fileKind = String(data.fileKind ?? "text");
			const files = data.files ?? [];
			const selectedNames = files.length > 0 ? files.map((item) => String(item?.fileName ?? "")).filter(Boolean) : [String(data.fileName ?? "")].filter(Boolean);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.nodeKinds.file }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NameField, {
					data,
					copy,
					onPatch
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.fileKind,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						value: fileKind,
						onChange: (event) => onPatch({
							fileKind: event.target.value,
							content: "",
							managedPath: void 0,
							fileName: "",
							files: []
						}),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "text",
							children: copy.fileKindLabel?.text
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "file",
							children: copy.fileKindLabel?.file
						})]
					})
				}),
				fileKind === "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextAreaField, {
					label: copy.fileContent,
					value: data.content,
					placeholder: copy.fileContent,
					onChange: (value) => onPatch({ content: value })
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-field",
					style: { gap: 6 },
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "file",
						multiple: true,
						onChange: (event) => {
							const picked = Array.from(event.target.files ?? []);
							if (picked.length > 0) onFileSelect(picked);
							event.target.value = "";
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-file-list",
						children: selectedNames.length > 0 ? selectedNames.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-file-chip",
							title: name,
							children: name
						}, name)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-hint",
							children: copy.fileUnset
						})
					})]
				})
			] });
		}
		function DatabaseForm({ data, copy, onPatch, onTest }) {
			const isServer = data.dbType === "server";
			const conn = data.conn ?? {};
			const vectorOptions = data.vectorOptions ?? {};
			const setOpt = (patch) => onPatch({ vectorOptions: {
				...vectorOptions,
				...patch
			} });
			const clampInt = (value, min, fallback, max) => {
				const n = Number(value);
				if (!Number.isFinite(n) || n < min) return min;
				return max === void 0 ? n : Math.min(max, n);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.nodeKinds.database }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NameField, {
					data,
					copy,
					onPatch
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextAreaField, {
					label: copy.description,
					value: data.description,
					placeholder: copy.descriptionHint,
					onChange: (value) => onPatch({ description: value })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.dbTypeLabel,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						value: String(data.dbType ?? "local"),
						onChange: (event) => onPatch({ dbType: event.target.value }),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "local",
							children: copy.dbTypeLocal
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "server",
							children: copy.dbTypeServer
						})]
					})
				}),
				isServer ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gap: 8
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
							label: copy.dbKindLabel,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: String(data.dbKind ?? "mysql"),
								onChange: (event) => onPatch({ dbKind: event.target.value }),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "mysql",
									children: "MySQL"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "postgresql",
									children: "PostgreSQL"
								})]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "2fr 1fr",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
								label: copy.dbHost,
								value: conn.host,
								onChange: (value) => onPatch({ conn: {
									...conn,
									host: value
								} })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
								label: copy.dbPort,
								type: "number",
								value: conn.port ?? "",
								onChange: (value) => onPatch({ conn: {
									...conn,
									port: Number(value) || 0
								} })
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
								label: copy.dbUser,
								value: conn.user,
								onChange: (value) => onPatch({ conn: {
									...conn,
									user: value
								} })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
								label: copy.dbPassword,
								type: "password",
								value: conn.password,
								onChange: (value) => onPatch({ conn: {
									...conn,
									password: value
								} })
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
							label: copy.dbName,
							value: conn.db,
							onChange: (value) => onPatch({ conn: {
								...conn,
								db: value
							} })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "wf-btn",
							onClick: onTest,
							disabled: !conn.host,
							children: copy.dbTest
						}) })
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gap: 8
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
							label: copy.dbLocalPath,
							value: data.localPath,
							placeholder: "D:\\data\\mydb.sqlite",
							onChange: (value) => onPatch({ localPath: value })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
							label: copy.dbVectorSource,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: String(data.vectorSource ?? "embedding"),
								onChange: (event) => onPatch({ vectorSource: event.target.value }),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "embedding",
									children: copy.dbVectorEmbedding
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "bm25",
									children: copy.dbVectorBm25
								})]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-hint",
							children: copy.dbLocalHint
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "wf-advanced",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: copy.dbAdvanced }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-advanced__content",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "grid",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
										label: copy.dbTopK,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 1,
											max: 50,
											value: Number(vectorOptions.topK ?? 5),
											onChange: (event) => setOpt({ topK: clampInt(event.target.value, 1, 5, 50) })
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
										label: copy.dbScoreThreshold,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											step: "0.1",
											value: Number(vectorOptions.scoreThreshold ?? 0),
											onChange: (event) => setOpt({ scoreThreshold: Number(event.target.value) || 0 })
										})
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "1fr 1fr",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
										label: copy.dbOverlap,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 0,
											value: Number(vectorOptions.overlap ?? 128),
											onChange: (event) => setOpt({ overlap: clampInt(event.target.value, 0, 0) })
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
										label: copy.dbChunkSize,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 1,
											value: Number(vectorOptions.chunkSize ?? 384),
											onChange: (event) => setOpt({ chunkSize: clampInt(event.target.value, 1, 1) })
										})
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
									label: copy.dbMaxRows,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "number",
										min: 1,
										value: Number(vectorOptions.maxRows ?? 1e4),
										onChange: (event) => setOpt({ maxRows: clampInt(event.target.value, 1, 1) })
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-hint",
									style: { whiteSpace: "pre-line" },
									children: copy.dbAdvancedHint
								})
							]
						})
					})]
				})
			] });
		}
		/** 阶段属性只读（无描述字段，无保存按钮，需求 §4.2.5.1）。 */
		function StageForm({ data, copy, nodeLabel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: nodeLabel || String(data.label ?? "") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-pathbox",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__label",
						children: copy.label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__value",
						children: String(data.label ?? "")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: copy.stageReadonlyHint
				})
			] });
		}
		/** 协作组（名称/协作 Prompt/成员列表删除）。模板态无成员（成员在画布内拖入登记），隐藏成员区。 */
		function GroupForm({ data, copy, members, onPatch, onLoadMd, onRemoveMember }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.nodeKinds.group }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NameField, {
					data,
					copy,
					onPatch
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.collabPrompt,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: String(data.collabPrompt ?? ""),
							placeholder: copy.collabPromptHint,
							spellCheck: false,
							onChange: (event) => onPatch({ collabPrompt: event.target.value })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 6
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn",
								title: copy.loadMdTitle,
								onClick: onLoadMd,
								children: copy.loadMd
							})
						})]
					})
				}),
				members !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.groupMembers,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-check-list",
						children: members.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-hint",
							children: copy.groupMemberHint
						}) : members.map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: { justifyContent: "space-between" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: member.label || member.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn is-danger",
								style: {
									fontSize: 9,
									padding: "2px 6px"
								},
								onClick: () => onRemoveMember(member.id),
								children: "✕"
							})]
						}, member.id))
					})
				}) : null
			] });
		}
		/** 虚拟节点只读（仅显示主节点名称，不可修改，§4.2.3.2 规则 3）。 */
		function ProxyForm({ data, copy, mainLabel }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.nodeKinds.proxy }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-pathbox",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__label",
						children: copy.proxyMainLabel
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__value",
						children: mainLabel || String(data.proxySourceId ?? "—")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: copy.proxyReadonlyHint
				})
			] });
		}
		function LinePanel({ data, copy, onPatch }) {
			const condition = data.condition ?? null;
			const type = condition?.type ?? "flow";
			const isContent = type === "content";
			const setType = (value) => {
				if (value === "flow") onPatch({ condition: null });
				else onPatch({ condition: {
					type: value,
					label: condition?.label ?? ""
				} });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.line }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field$1, {
					label: copy.lineType,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						value: type,
						onChange: (event) => setType(event.target.value),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "flow",
								children: copy.lineTypeFlow
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "pass",
								children: copy.lineTypePass
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "fail",
								children: copy.lineTypeFail
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "content",
								children: copy.lineTypeContent
							})
						]
					})
				}),
				isContent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
					label: copy.lineContentValue,
					value: condition?.label ?? "",
					placeholder: copy.lineContentHint,
					onChange: (value) => onPatch({ condition: {
						type: "content",
						label: value
					} })
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "wf-hint",
					children: copy.lineConditionHint
				})
			] });
		}
		function WorkflowForm({ data, copy, isService, flowMeta, onPatch }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: isService ? copy.service : copy.workflow }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InputField, {
					label: copy.flowName,
					value: data.name,
					onChange: (value) => onPatch({ name: value })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextAreaField, {
					label: copy.flowDescription,
					value: data.description,
					placeholder: copy.flowDescription,
					onChange: (value) => onPatch({ description: value })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-pathbox",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__label",
						children: copy.meta
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-pathbox__value",
						children: `${flowMeta.nodeCount} ${copy.nodes ?? "nodes"} · rev ${flowMeta.revision} · ${isService ? copy.mode2 : copy.mode1}`
					})]
				})
			] });
		}
		//#endregion
		//#region src/client/components/panels/inspector/Inspector.tsx
		function Inspector(props) {
			const { copy: t, open, width, editorData, presets, tools, models, combos, flowMeta, onPatch, onDelete, onSave, onSaveAsTemplate, onCopyProxy, onRemoveMember, onFileSelect, onLoadMd, onLoadGroupMd, onTestDb, saveDisabled, importBusy } = props;
			let content;
			if (!editorData) content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wf-empty",
				children: t.inspectorEmpty
			});
			else {
				const data = editorData.data;
				switch (editorData.kind) {
					case "workflow":
					case "service":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowForm, {
							data,
							copy: t,
							isService: editorData.kind === "service",
							flowMeta,
							onPatch
						});
						break;
					case "role":
						content = editorData.isParent && editorData.template ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-empty",
							children: String(t.parentTemplateHint ?? "")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RoleForm, {
							data,
							copy: t,
							presets,
							models,
							combos,
							onPatch,
							onLoadMd,
							isParent: editorData.isParent === true,
							allowCombos: editorData.isParent !== true
						});
						break;
					case "file":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileForm, {
							data,
							copy: t,
							onPatch,
							onFileSelect
						});
						break;
					case "database":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DatabaseForm, {
							data,
							copy: t,
							onPatch,
							onTest: onTestDb
						});
						break;
					case "group":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupForm, {
							data,
							copy: t,
							members: editorData.members,
							onPatch,
							onLoadMd: onLoadGroupMd,
							onRemoveMember
						});
						break;
					case "stage":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageForm, {
							data,
							copy: t,
							nodeLabel: String(data.label ?? "")
						});
						break;
					case "proxy":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProxyForm, {
							data,
							copy: t,
							mainLabel: editorData.mainLabel ?? ""
						});
						break;
					case "edge":
						content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LinePanel, {
							data,
							copy: t,
							onPatch
						});
						break;
					default: content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-empty",
						children: t.inspectorEmpty
					});
				}
			}
			const footer = [];
			if (editorData) {
				const kind = editorData.kind;
				const isStage = kind === "stage";
				const canCopyProxy = kind === "role" && !editorData.template;
				if (!isStage) footer.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn is-primary",
					onClick: onSave,
					disabled: importBusy || saveDisabled,
					children: t.inspectorSave
				}, "save"));
				footer.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn is-danger",
					onClick: onDelete,
					disabled: importBusy,
					children: t.inspectorDelete
				}, "delete"));
				if (canCopyProxy) footer.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn",
					onClick: onCopyProxy,
					disabled: importBusy,
					children: t.inspectorCopy
				}, "copy"));
				if ((kind === "workflow" || kind === "service") && !editorData.template && onSaveAsTemplate) footer.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn",
					onClick: onSaveAsTemplate,
					disabled: importBusy,
					children: String(t.saveAsTemplate ?? "")
				}, "save-as-template"));
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: `wf-inspector${open ? "" : " is-collapsed"}`,
				style: { width: open ? width : void 0 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-inspector__scroll",
					children: content
				}), footer.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "wf-inspector__footer",
					children: footer
				}) : null]
			});
		}
		//#endregion
		//#region src/client/components/confirm-dialog/ConfirmDialog.tsx
		function ConfirmDialog({ confirm, copy, onClose, onSaveAndProceed, onDiscardAndProceed, onResolveImport }) {
			if (!confirm) return null;
			const title = confirm.kind === "unsaved" ? copy.unsavedTitle : confirm.kind === "importConflict" ? copy.importConflictTitle : confirm.title ?? copy.confirmDelete;
			const message = confirm.kind === "unsaved" ? copy.unsavedMessage : confirm.message ?? "";
			const actions = confirm.kind === "unsaved" ? [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn is-primary",
					onClick: onSaveAndProceed,
					children: copy.unsavedSave
				}, "save"),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn is-danger",
					onClick: onDiscardAndProceed,
					children: copy.unsavedDiscard
				}, "discard"),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn",
					onClick: onClose,
					children: copy.unsavedCancel
				}, "cancel")
			] : confirm.kind === "importConflict" ? [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn is-danger",
					onClick: () => onResolveImport("overwrite"),
					children: copy.importOverwrite
				}, "overwrite"),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn",
					onClick: () => onResolveImport("rename"),
					children: copy.importRename
				}, "rename"),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "wf-btn",
					onClick: onClose,
					children: copy.importCancel
				}, "cancel")
			] : [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "wf-btn is-danger",
				onClick: () => {
					const handler = confirm.onConfirm;
					onClose();
					handler?.();
				},
				children: confirm.confirmLabel ?? copy.inspectorDelete
			}, "ok"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "wf-btn",
				onClick: onClose,
				children: copy.unsavedCancel
			}, "cancel")];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wf-confirm-backdrop",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-confirm",
					role: "dialog",
					"aria-modal": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: title }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: message }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-confirm__actions",
							children: actions
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/components/run-history/RunHistory.tsx
		function statusLabel(status, copy) {
			return String(copy.status[status] ?? status ?? "");
		}
		function formatTime(value) {
			if (!value) return "";
			try {
				const date = new Date(value);
				if (Number.isNaN(date.getTime())) return String(value);
				return date.toLocaleString();
			} catch {
				return String(value);
			}
		}
		const RESUMABLE = /* @__PURE__ */ new Set([
			"paused",
			"interrupted",
			"stopped"
		]);
		function RunHistory({ history, selectedRunId, copy, onSelect, onClose, onResume, canResume }) {
			const items = Array.isArray(history) ? history : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wf-history-backdrop",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-history",
					role: "dialog",
					"aria-modal": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.history }),
						items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								color: "var(--wf-ink-2)",
								fontSize: 12
							},
							children: copy.historyEmpty
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-history__list",
							children: items.map((run) => {
								const resumable = canResume && RESUMABLE.has(run.status);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: `wf-history__item${run.id === selectedRunId ? " is-active" : ""}`,
									onClick: () => onSelect(run.id),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "wf-history__title",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `wf-status-dot${run.status === "running" ? " is-running" : ""}` }),
												`${run.flowName ?? run.flowId}`,
												run.resumedFromRunId ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wf-history__chain",
													children: `${copy.resumedFrom} #${String(run.resumedFromRunId).slice(0, 8)}`
												}) : null
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-history__meta",
											children: `${statusLabel(run.status, copy)} · ${formatTime(run.startedAt)}${run.resumeFromNodeId ? ` · ${copy.resumeFromNode} ${run.resumeFromNodeId}` : ""}${run.summary ? ` · ${run.summary}` : ""}`
										}),
										run.nodes?.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-history__meta",
											children: run.nodes.map((node) => `${node.nodeId}:${statusLabel(node.status, copy)}`).join("  ")
										}) : null,
										resumable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-history__resume",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "wf-btn is-primary",
												onClick: (event) => {
													event.stopPropagation();
													onResume(run.id);
												},
												children: copy.resumeRun
											})
										}) : null
									]
								}, run.id);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-history__actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn",
								onClick: onClose,
								children: "✕"
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/components/service-console/ServiceConsole.tsx
		/**
		* 解析后端 SSE data 行的内容增量（Bug 3）。
		* 后端 openai-api 的 sseChunk 把正文放在 choices[0].delta.content；
		* 为兼容旧增量格式（delta.content）做回退取值。
		* @returns { content?, error? } 增量文本或错误消息（无匹配返回空对象）。
		*/
		function parseSseDelta(data) {
			let parsed;
			try {
				parsed = JSON.parse(data);
			} catch {
				return {};
			}
			if (parsed.error?.message) return { error: String(parsed.error.message) };
			const content = parsed.choices?.[0]?.delta?.content ?? parsed.delta?.content;
			return typeof content === "string" && content ? { content } : {};
		}
		function ServiceConsole({ copy, service, sessionId, busy }) {
			const [prompt, setPrompt] = (0, react.useState)("");
			const [output, setOutput] = (0, react.useState)("");
			const [streaming, setStreaming] = (0, react.useState)(false);
			const abortRef = (0, react.useRef)(null);
			const outputRef = (0, react.useRef)(null);
			const status = service?.status ?? "stopped";
			const running = status === "running";
			(0, react.useEffect)(() => {
				if (status !== "running") {
					abortRef.current?.abort();
					abortRef.current = null;
					setStreaming(false);
				}
			}, [status]);
			(0, react.useEffect)(() => {
				const node = outputRef.current;
				if (node) node.scrollTop = node.scrollHeight;
			}, [output]);
			const stopDebug = (0, react.useCallback)(() => {
				abortRef.current?.abort();
				abortRef.current = null;
			}, []);
			const sendDebug = (0, react.useCallback)(async () => {
				const text = prompt.trim();
				if (!text || !running || streaming) return;
				const controller = new AbortController();
				abortRef.current = controller;
				setStreaming(true);
				setOutput("");
				try {
					await streamCall(EP_SERVICE_DEBUG, {
						serviceId: service?.id ?? "",
						sessionId,
						prompt: text
					}, (line) => {
						if (!line.startsWith("data: ")) return;
						const data = line.slice(6).trim();
						if (!data || data === "[DONE]") return;
						const delta = parseSseDelta(data);
						if (delta.error) setOutput((prev) => `${prev ? `${prev}\n\n` : ""}[错误] ${delta.error}`);
						else if (delta.content) setOutput((prev) => prev + delta.content);
					}, controller.signal);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					setOutput((prev) => `${prev ? `${prev}\n\n` : ""}[错误] ${message}`);
				} finally {
					setStreaming(false);
					abortRef.current = null;
				}
			}, [
				prompt,
				running,
				sessionId,
				service?.id,
				streaming
			]);
			if (!service || !running) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: "wf-service-console",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-service-console__debug",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-service-console__debug-head",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-service-console__debug-title",
								children: copy.serviceDebugTitle
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-hint",
								children: copy.serviceDebugHint
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "wf-service-console__input",
							value: prompt,
							rows: 2,
							placeholder: copy.serviceDebugPlaceholder,
							disabled: busy,
							onChange: (event) => setPrompt(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									sendDebug();
								}
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-service-console__debug-actions",
							children: streaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn is-danger",
								onClick: stopDebug,
								children: copy.serviceDebugStop
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn is-primary",
								onClick: () => {
									sendDebug();
								},
								disabled: busy || !prompt.trim(),
								children: copy.serviceDebugSend
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							ref: outputRef,
							className: "wf-service-console__output",
							children: output || copy.serviceDebugEmpty
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/lib/tool-tags.ts
		/** MCP 工具名前缀常量（官方 publicToolName 拼装规则）。 */
		const MCP_TOOL_PREFIX = "mcp__";
		/** 「官方工具」Tag 键。 */
		const TAG_BUILTIN = "builtin";
		/**
		* 从工具名解析 MCP 服务器命名空间（mcp__<server>__<tool> → <server>）。
		* 非 MCP 名 / 形如 mcp__xxx（无第二段）返回 null。
		*/
		function mcpServerOfToolName(name) {
			const text = String(name ?? "");
			if (!text.startsWith("mcp__")) return null;
			const rest = text.slice(5);
			const sep = rest.indexOf("__");
			if (sep <= 0) return null;
			return rest.slice(0, sep);
		}
		/**
		* 判断工具名是否属于某服务器（前缀匹配；server 为配置名或解析命名空间均可）。
		*/
		function toolBelongsToServer(name, server) {
			return String(name ?? "").startsWith(`${MCP_TOOL_PREFIX}${server}__`);
		}
		/**
		* 服务器名规范化（镜像官方 mcp-client 的 INVALID_NAME_CHARS 替换规则：
		* 非 [A-Za-z0-9_-] 字符替换为下划线）。用于把工具名解析出的命名空间
		* 反查回已配置 serverName（标签显示配置原名）。
		*/
		function normalizeServerName(serverName) {
			return String(serverName ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
		}
		/**
		* 构建 Tag 列表：[全部] + [官方工具] + 动态 MCP Tag（首次出现顺序）。
		* @param toolNames 工具目录全量名（pluginCatalog.items[].name）
		* @param configuredServers 已配置 MCP 服务器（serverName 优先作为标签显示）
		*/
		function buildToolTags(toolNames, configuredServers = []) {
			const namespaces = [];
			for (const name of toolNames ?? []) {
				const server = mcpServerOfToolName(name);
				if (server === null) continue;
				if (!namespaces.includes(server)) namespaces.push(server);
			}
			const configured = configuredServers.map((item) => String(item?.serverName ?? "").trim()).filter(Boolean);
			const tags = [{
				key: "all",
				label: "全部",
				kind: "all"
			}, {
				key: TAG_BUILTIN,
				label: "官方工具",
				kind: "builtin"
			}];
			for (const namespace of namespaces) {
				const label = configured.find((serverName) => normalizeServerName(serverName) === namespace) ?? namespace;
				tags.push({
					key: `mcp:${namespace}`,
					label,
					kind: "mcp",
					server: namespace
				});
			}
			return tags;
		}
		/**
		* 按当前激活 Tag 过滤工具名（纯函数）：
		*   - all：全部保留；
		*   - builtin：仅非 MCP 工具；
		*   - mcp:<server>：仅隶属于该命名空间的工具（前缀匹配）。
		*/
		function filterToolNamesByTag(toolNames, activeTag) {
			return (toolNames ?? []).filter((name) => {
				if (activeTag === "all") return true;
				if (activeTag === "builtin") return mcpServerOfToolName(name) === null;
				if (activeTag.startsWith("mcp:")) return toolBelongsToServer(name, activeTag.slice(4));
				return true;
			});
		}
		//#endregion
		//#region src/client/components/combo-manager/ComboManager.tsx
		/** 把 {command, args} 拼回一整行（含空格的 token 加引号），供导入时回填 commandLine。 */
		function joinCommandLine(command, args) {
			return [String(command ?? ""), ...(Array.isArray(args) ? args : []).map((arg) => String(arg))].filter((token) => token !== "").map((token) => {
				if (/^[A-Za-z0-9_./\\:=@%+,\[\]{}#-]+$/.test(token) && !/["']/.test(token)) return token;
				if (!token.includes("\"")) return `"${token}"`;
				if (!token.includes("'")) return `'${token}'`;
				return `"${token.replace(/"/g, "\\\"")}"`;
			}).join(" ");
		}
		/** 解析 env / headers 的 JSON 字符串为对象（空串 → {}）。 */
		function parseJsonObject(text) {
			const value = String(text ?? "").trim();
			if (!value) return {};
			const obj = JSON.parse(value);
			if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
			throw new Error("环境变量/请求头需为 JSON 对象");
		}
		function ComboManager({ copy, remote, sessionId, onClose, onToast, onChanged }) {
			const [catalog, setCatalog] = (0, react.useState)({
				items: [],
				mcp: [],
				loadedPlugins: [],
				disabledTools: []
			});
			const [combos, setCombos] = (0, react.useState)([]);
			const [tab, setTab] = (0, react.useState)("plugins");
			const [search, setSearch] = (0, react.useState)("");
			const [activeTag, setActiveTag] = (0, react.useState)("all");
			const [disabledTools, setDisabledTools] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [activeComboId, setActiveComboId] = (0, react.useState)(null);
			const [comboDraft, setComboDraft] = (0, react.useState)({
				name: "",
				tools: [],
				mcpServers: []
			});
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			const [mcpForm, setMcpForm] = (0, react.useState)(null);
			const [mcpImportOpen, setMcpImportOpen] = (0, react.useState)(false);
			const [mcpImportText, setMcpImportText] = (0, react.useState)("");
			const loadedRef = (0, react.useRef)(false);
			const load = (0, react.useCallback)(async () => {
				try {
					const [catalogData, combosData] = await Promise.all([remote.call(EP_PLUGIN_CATALOG, { sessionId }).catch(() => ({
						items: [],
						mcp: [],
						loadedPlugins: [],
						disabledTools: []
					})), remote.call(EP_TOOL_COMBOS).catch(() => [])]);
					const cat = catalogData ?? {};
					setCatalog({
						items: Array.isArray(cat.items) ? cat.items : [],
						mcp: Array.isArray(cat.mcp) ? cat.mcp : [],
						loadedPlugins: Array.isArray(cat.loadedPlugins) ? cat.loadedPlugins : [],
						disabledTools: Array.isArray(cat.disabledTools) ? cat.disabledTools : []
					});
					setDisabledTools(new Set(Array.isArray(cat.disabledTools) ? cat.disabledTools : []));
					const comboItems = Array.isArray(combosData) ? combosData : [];
					setCombos(comboItems);
					setActiveComboId((current) => {
						if (current && comboItems.some((item) => item.id === current)) return current;
						const first = comboItems[0];
						if (first) {
							setComboDraft({
								name: first.name,
								tools: (first.tools ?? []).filter((name) => name !== "run_code"),
								mcpServers: [...first.mcpServers ?? []]
							});
							return first.id;
						}
						return current;
					});
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				}
			}, [
				remote,
				sessionId,
				onToast
			]);
			(0, react.useEffect)(() => {
				if (loadedRef.current) return;
				loadedRef.current = true;
				load();
			}, [load]);
			const selectCombo = (0, react.useCallback)((id) => {
				setActiveComboId(id);
				setConfirmDelete(false);
				const combo = combos.find((item) => item.id === id);
				setComboDraft({
					name: combo?.name ?? "",
					tools: (combo?.tools ?? []).filter((name) => name !== "run_code"),
					mcpServers: [...combo?.mcpServers ?? []]
				});
			}, [combos]);
			const newCombo = (0, react.useCallback)(() => {
				setActiveComboId(`combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
				setConfirmDelete(false);
				setComboDraft({
					name: "",
					tools: [],
					mcpServers: []
				});
			}, []);
			const saveCombo = (0, react.useCallback)(async () => {
				if (!comboDraft.name.trim()) {
					onToast("error", copy.comboSaveFirst);
					return;
				}
				setBusy(true);
				try {
					await remote.call(EP_TOOL_COMBO_PUT, { combo: {
						id: activeComboId ?? `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
						name: comboDraft.name.trim(),
						tools: [...comboDraft.tools],
						mcpServers: [...comboDraft.mcpServers]
					} });
					await load();
					onChanged?.();
					onToast("success", copy.comboSaved);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				activeComboId,
				comboDraft,
				copy.comboSaveFirst,
				copy.comboSaved,
				load,
				onChanged,
				onToast,
				remote
			]);
			const deleteCombo = (0, react.useCallback)(async () => {
				if (!activeComboId) return;
				if (!confirmDelete) {
					setConfirmDelete(true);
					return;
				}
				setConfirmDelete(false);
				setBusy(true);
				try {
					await remote.call(EP_TOOL_COMBO_DELETE, { id: activeComboId });
					setActiveComboId(null);
					setComboDraft({
						name: "",
						tools: [],
						mcpServers: []
					});
					await load();
					onChanged?.();
					onToast("success", copy.comboDeleted);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				activeComboId,
				confirmDelete,
				copy.comboDeleted,
				load,
				onChanged,
				onToast,
				remote
			]);
			const toggleTool = (0, react.useCallback)((name) => {
				setComboDraft((draft) => ({
					...draft,
					tools: draft.tools.includes(name) ? draft.tools.filter((item) => item !== name) : [...draft.tools, name]
				}));
			}, []);
			const toggleMcp = (0, react.useCallback)((serverName) => {
				setComboDraft((draft) => ({
					...draft,
					mcpServers: draft.mcpServers.includes(serverName) ? draft.mcpServers.filter((item) => item !== serverName) : [...draft.mcpServers, serverName]
				}));
			}, []);
			/**
			* 单个工具的全局开关（父代理白名单「关闭」侧）：
			*   - 关闭后该工具在所有会话的代理上下文中不可见（system-prompt/assemble 瀑布剔除）；
			*   - 关闭的工具不得留在组合草稿（父代理不可用 → 子代理无法传入），自动去除勾选；
			*   - 状态更新即全局即时生效（无需运行工作流）。
			*/
			const toggleToolDisabled = (0, react.useCallback)(async (name, disabled) => {
				setBusy(true);
				try {
					const result = await remote.call(EP_TOOL_SWITCH_PUT, {
						name,
						disabled
					});
					const next = new Set(Array.isArray(result?.disabled) ? result.disabled.map((item) => String(item)) : []);
					setDisabledTools(next);
					if (disabled) setComboDraft((draft) => ({
						...draft,
						tools: draft.tools.filter((item) => item !== name)
					}));
					onToast("success", disabled ? copy.toolSwitchDisabled : copy.toolSwitchEnabled);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				copy.toolSwitchDisabled,
				copy.toolSwitchEnabled,
				onToast,
				remote
			]);
			/**
			* 一键开关当前标签下全部工具（组合管理「标签」胶囊栏右侧按钮）：
			*   - 仅作用于当前激活标签（官方工具 / MCP 服务器标签）命中的工具集合，
			*     不影响其他标签或官方工具——filterToolNamesByTag 按标签语义收窄；
			*   - 关闭状态目标 = 标签下所有工具是否已全部关闭：全部关闭则一键开启，
			*     否则一键关闭（幂等；空标签或「全部」标签下无明确工具集合时禁用）；
			*   - 关闭成功后将标签下工具从组合草稿移除（父代理不可用 → 子代理无法传入）。
			*/
			const toggleTagBulkToolDisabled = (0, react.useCallback)(async (disabled) => {
				const toolNames = filterToolNamesByTag((catalog.items ?? []).map((item) => item.name), activeTag);
				if (toolNames.length === 0) return;
				setBusy(true);
				try {
					const result = await remote.call(EP_TOOL_SWITCH_PUT_MANY, {
						names: toolNames,
						disabled
					});
					const next = new Set(Array.isArray(result?.disabled) ? result.disabled.map((item) => String(item)) : []);
					setDisabledTools(next);
					if (disabled) setComboDraft((draft) => ({
						...draft,
						tools: draft.tools.filter((item) => !toolNames.includes(item))
					}));
					onToast("success", disabled ? copy.toolSwitchBatchDisabled : copy.toolSwitchBatchEnabled);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				activeTag,
				catalog.items,
				copy.toolSwitchBatchDisabled,
				copy.toolSwitchBatchEnabled,
				onToast,
				remote
			]);
			const deleteMcp = (0, react.useCallback)(async (id) => {
				setBusy(true);
				try {
					await remote.call(EP_MCP_DELETE, { id });
					await load();
					onToast("success", copy.mcpDeleted);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				copy.mcpDeleted,
				load,
				onToast,
				remote
			]);
			/** MCP 服务器启用/停用切换（停用后该服务器工具不再进入组合工具集）。 */
			const toggleMcpDisabled = (0, react.useCallback)(async (id, disabled) => {
				setBusy(true);
				try {
					await remote.call(EP_MCP_TOGGLE, {
						id,
						disabled
					});
					await load();
					onToast("success", disabled ? copy.mcpDisabled : copy.mcpEnabled);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				copy.mcpDisabled,
				copy.mcpEnabled,
				load,
				onToast,
				remote
			]);
			const saveMcp = (0, react.useCallback)(async () => {
				if (!mcpForm) return;
				setBusy(true);
				try {
					let env = {};
					let headers = {};
					try {
						env = parseJsonObject(mcpForm.env);
						headers = parseJsonObject(mcpForm.headers);
					} catch (error) {
						onToast("error", String(error?.message ?? error));
						setBusy(false);
						return;
					}
					const server = {
						id: mcpForm.id ?? null,
						serverName: mcpForm.serverName,
						transport: mcpForm.transport,
						commandLine: mcpForm.transport === "stdio" ? mcpForm.commandLine : void 0,
						env: mcpForm.transport === "stdio" && Object.keys(env).length > 0 ? env : void 0,
						headers: mcpForm.transport === "streamable-http" && Object.keys(headers).length > 0 ? headers : void 0,
						url: mcpForm.transport === "streamable-http" ? mcpForm.url : void 0
					};
					await remote.call(EP_MCP_PUT, { server });
					setMcpForm(null);
					await load();
					onToast("success", copy.mcpSaved);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				copy.mcpSaved,
				load,
				mcpForm,
				onToast,
				remote
			]);
			/** 从 mcp.json 粘贴导入：支持 {mcpServers:{name:{...}}} 或单个 server 对象。 */
			const importMcpJson = (0, react.useCallback)(() => {
				try {
					const raw = String(mcpImportText ?? "").trim();
					if (!raw) throw new Error("请先粘贴 mcp.json 配置");
					let data = JSON.parse(raw);
					if (data && typeof data === "object" && data.mcpServers && typeof data.mcpServers === "object") {
						const entries = Object.entries(data.mcpServers);
						if (entries.length === 0) throw new Error("mcpServers 配置为空");
						const [name, server] = entries[0];
						data = {
							...server,
							serverName: server?.serverName ?? name
						};
					}
					const transport = data.transport === "streamable-http" || data.url ? "streamable-http" : "stdio";
					const command = String(data.command ?? "");
					const args = Array.isArray(data.args) ? data.args.map((item) => String(item)) : [];
					setMcpForm({
						id: void 0,
						serverName: String(data.serverName ?? data.name ?? ""),
						transport,
						commandLine: transport === "stdio" ? joinCommandLine(command, args) : "",
						env: data.env && typeof data.env === "object" && Object.keys(data.env).length > 0 ? JSON.stringify(data.env) : "",
						headers: data.headers && typeof data.headers === "object" && Object.keys(data.headers).length > 0 ? JSON.stringify(data.headers) : "",
						url: String(data.url ?? "")
					});
					setMcpImportOpen(false);
					onToast("success", copy.mcpImported);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				}
			}, [
				copy.mcpImported,
				mcpImportText,
				onToast
			]);
			const tabs = [{
				key: "plugins",
				label: copy.comboTabDsh,
				count: catalog.items.length
			}, {
				key: "mcp",
				label: copy.comboTabMcp,
				count: catalog.mcp.length
			}];
			/** 筛选标签（动态构建）：[全部] + [官方工具] + MCP 服务器 Tag（按目录首次出现顺序） */
			const toolTags = (0, react.useMemo)(() => buildToolTags((catalog.items ?? []).map((item) => item.name), catalog.mcp), [catalog.items, catalog.mcp]);
			/**
			* 当前激活标签命中的工具集合（一键开关目标；MCP 服务器标签 / 官方工具标签）。
			* 「全部」标签回退为空集（无明确批量语义，按钮禁用）。
			*/
			const tagToolNames = (0, react.useMemo)(() => activeTag === "all" ? [] : filterToolNamesByTag((catalog.items ?? []).map((item) => item.name), activeTag), [activeTag, catalog.items]);
			/** 当前标签下工具是否已全部关闭（一键开关按钮目标态：全部关闭 → 显示「一键开启」）。 */
			const tagToolsAllDisabled = (0, react.useMemo)(() => tagToolNames.length > 0 && tagToolNames.every((name) => disabledTools.has(name)), [tagToolNames, disabledTools]);
			const gridItems = (0, react.useMemo)(() => {
				try {
					const keyword = String(search ?? "").trim().toLowerCase();
					if (tab === "plugins") return (catalog.items ?? []).filter((item) => {
						if (activeTag === "all") return true;
						const isMcp = item.name.startsWith("mcp__");
						if (activeTag === "builtin") return !isMcp;
						if (activeTag.startsWith("mcp:")) return isMcp && item.name.startsWith(`mcp__${activeTag.slice(4)}__`);
						return true;
					}).filter((item) => !keyword || String(item.name ?? "").toLowerCase().includes(keyword) || String(item.description ?? "").toLowerCase().includes(keyword)).map((item) => {
						const disabledTool = disabledTools.has(item.name);
						return {
							key: item.key ?? `item:${item.name}`,
							name: item.name,
							description: item.description,
							disabled: disabledTool,
							checked: !disabledTool && (comboDraft.tools ?? []).includes(item.name),
							onToggle: disabledTool ? () => {} : () => toggleTool(item.name),
							onToggleDisabled: () => {
								toggleToolDisabled(item.name, !disabledTool);
							}
						};
					});
					return (catalog.mcp ?? []).filter((server) => !keyword || String(server.serverName ?? "").toLowerCase().includes(keyword) || String(server.description ?? "").toLowerCase().includes(keyword)).map((server) => {
						const name = String(server.serverName ?? "").trim() || String(server.id ?? "");
						return {
							key: `mcp:${server.id}`,
							name,
							description: server.description,
							disabled: server.disabled === true,
							badge: server.disabled ? "已停用" : server.transport === "streamable-http" ? "HTTP" : "stdio",
							checked: (comboDraft.mcpServers ?? []).includes(name),
							onToggle: () => toggleMcp(name),
							onEdit: () => setMcpForm({
								id: server.id,
								serverName: name,
								transport: server.transport ?? "stdio",
								commandLine: String(server.commandLine ?? server.command ?? ""),
								env: server.env && Object.keys(server.env).length > 0 ? JSON.stringify(server.env) : "",
								headers: server.headers && Object.keys(server.headers).length > 0 ? JSON.stringify(server.headers) : "",
								url: server.url ?? ""
							}),
							onToggleDisabled: server.disabled === true ? () => {
								toggleMcpDisabled(server.id, false);
							} : () => {
								toggleMcpDisabled(server.id, true);
							},
							onDelete: () => {
								deleteMcp(server.id);
							}
						};
					});
				} catch {
					return [];
				}
			}, [
				catalog,
				comboDraft,
				search,
				tab,
				activeTag,
				disabledTools,
				toggleMcp,
				toggleTool,
				toggleToolDisabled,
				deleteMcp,
				toggleMcpDisabled
			]);
			const selectedChips = (0, react.useMemo)(() => [...comboDraft.tools.map((name) => ({
				key: `t:${name}`,
				label: name,
				remove: () => toggleTool(name)
			})), ...comboDraft.mcpServers.map((name) => ({
				key: `m:${name}`,
				label: name,
				remove: () => toggleMcp(name)
			}))], [
				comboDraft,
				toggleMcp,
				toggleTool
			]);
			const editingMcp = tab === "mcp" && mcpForm !== null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wf-combo-backdrop",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-combo",
					role: "dialog",
					"aria-modal": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-combo__head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.comboManager }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "wf-status",
									children: copy.comboHint
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wf-btn wf-combo__close",
									onClick: onClose,
									children: "✕"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-combo__body",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-combo__catalog",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__tabs",
										children: tabs.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `wf-combo__tab${tab === item.key ? " is-active" : ""}`,
											onClick: () => setTab(item.key),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wf-combo__tab-count",
												children: String(item.count)
											})]
										}, item.key))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__search",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											value: search,
											placeholder: copy.comboSearch,
											onChange: (event) => setSearch(event.target.value)
										})
									}),
									tab === "plugins" && toolTags.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "wf-combo__tags",
										children: [toolTags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: `wf-combo-tag${activeTag === tag.key ? " is-active" : ""}`,
											onClick: () => setActiveTag((current) => current === tag.key ? "all" : tag.key),
											children: tag.label
										}, tag.key)), tagToolNames.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "wf-combo-tag wf-combo-tag__bulk",
											onClick: () => {
												toggleTagBulkToolDisabled(!tagToolsAllDisabled);
											},
											disabled: busy,
											title: copy.comboTagBulkHint,
											children: tagToolsAllDisabled ? copy.comboTagEnableAll : copy.comboTagDisableAll
										}) : null]
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__grid",
										children: gridItems.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wf-hint",
											style: {
												gridColumn: "1 / -1",
												padding: 14
											},
											children: String(search ?? "").trim() ? copy.comboSearchEmpty : copy.comboEmpty
										}) : gridItems.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: `wf-combo-card${item.checked ? " is-checked" : ""}${item.disabled ? " is-disabled" : ""}`,
											style: { position: "relative" },
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "wf-combo-card__main",
												style: {
													display: "flex",
													gap: 9,
													alignItems: "flex-start",
													textAlign: "left",
													border: 0,
													background: "transparent",
													padding: 0,
													paddingRight: 88,
													paddingBottom: 30,
													flex: 1,
													cursor: item.disabled ? "default" : "pointer"
												},
												onClick: item.onToggle,
												title: item.name,
												disabled: item.disabled,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													readOnly: true,
													checked: item.checked === true,
													disabled: item.disabled
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "wf-combo-card__body",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "wf-combo-card__name",
															children: item.name
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "wf-combo-card__desc",
															children: item.description
														}),
														item.badge ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "wf-combo-card__badge",
															children: item.badge
														}) : null
													]
												})]
											}), item.onEdit || item.onDelete || item.onToggleDisabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													display: "flex",
													gap: 4,
													position: "absolute",
													right: 8,
													bottom: 8
												},
												children: [
													item.onEdit ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn",
														style: {
															fontSize: 9,
															padding: "2px 6px"
														},
														onClick: (event) => {
															event.stopPropagation();
															item.onEdit?.();
														},
														children: copy.mcpEdit
													}) : null,
													item.onToggleDisabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn",
														style: {
															fontSize: 9,
															padding: "2px 6px"
														},
														onClick: (event) => {
															event.stopPropagation();
															item.onToggleDisabled?.();
														},
														children: item.disabled ? copy.toolEnable : copy.toolDisable
													}) : null,
													item.onDelete ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn is-danger",
														style: {
															fontSize: 9,
															padding: "2px 6px"
														},
														onClick: (event) => {
															event.stopPropagation();
															item.onDelete?.();
														},
														children: copy.mcpDelete
													}) : null
												]
											}) : null]
										}, item.key))
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-combo__side",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "wf-combo__side-head",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: copy.combos }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "wf-btn",
											onClick: newCombo,
											disabled: busy,
											children: `＋ ${copy.comboNew}`
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__side-list",
										children: combos.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "wf-hint",
											children: copy.comboEmpty
										}) : combos.map((combo) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: `wf-combo-item${combo.id === activeComboId ? " is-active" : ""}`,
											onClick: () => selectCombo(combo.id),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wf-combo-item__label",
												children: combo.name
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wf-combo-item__meta",
												children: `${combo.tools?.length ?? 0} ${copy.comboTabTool ?? ""} · ${combo.mcpServers?.length ?? 0} MCP`
											})]
										}, combo.id))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__edit",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.comboName
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: comboDraft.name,
											placeholder: copy.comboName,
											onChange: (event) => setComboDraft((draft) => ({
												...draft,
												name: event.target.value
											}))
										})] })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo__selection",
										children: selectedChips.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.comboEmptySelection
										}) : selectedChips.map((chip) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "wf-combo-chip",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: chip.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												onClick: chip.remove,
												title: copy.inspectorDelete,
												children: "×"
											})]
										}, chip.key))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "wf-combo__side-foot",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "wf-btn is-danger",
											onClick: () => {
												deleteCombo();
											},
											disabled: !activeComboId || busy,
											children: confirmDelete ? copy.comboDeleteConfirm : copy.comboDelete
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "wf-btn is-primary",
											onClick: () => {
												saveCombo();
											},
											disabled: busy,
											children: copy.inspectorSave
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-combo-hint",
										children: copy.comboHint
									})
								]
							})]
						}),
						editingMcp ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-mcp-form",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wf-combo__head",
									style: {
										borderTop: "1px solid var(--wf-border)",
										padding: "8px 14px"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: mcpForm.id ? copy.mcpEdit : copy.mcpNew })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8,
										padding: "0 14px 12px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: { flex: 1 },
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.mcpName
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: mcpForm.serverName ?? "",
											onChange: (event) => setMcpForm((form) => ({
												...form,
												serverName: event.target.value
											}))
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: { flex: 1 },
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.mcpTransport
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: mcpForm.transport ?? "stdio",
											onChange: (event) => setMcpForm((form) => ({
												...form,
												transport: event.target.value
											})),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "stdio",
												children: copy.mcpTransportStdio
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "streamable-http",
												children: copy.mcpTransportHttp
											})]
										})]
									})]
								}),
								(mcpForm.transport ?? "stdio") === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gap: 8,
										padding: "0 14px 12px"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.mcpCommand
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: mcpForm.commandLine ?? "",
											placeholder: "npx -y @playwright/mcp@latest --headless",
											onChange: (event) => setMcpForm((form) => ({
												...form,
												commandLine: event.target.value
											}))
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											children: copy.mcpEnv
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: mcpForm.env ?? "",
											placeholder: "{\"API_KEY\":\"...\"}",
											onChange: (event) => setMcpForm((form) => ({
												...form,
												env: event.target.value
											}))
										})] }),
										copy.mcpCommandHint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											style: {
												fontSize: 10,
												lineHeight: 1.5,
												color: "var(--wf-ink-2)"
											},
											children: copy.mcpCommandHint
										}) : null
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gap: 8,
										padding: "0 14px 12px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-hint",
										children: copy.mcpUrl
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: mcpForm.url ?? "",
										placeholder: "https://example.com/mcp",
										onChange: (event) => setMcpForm((form) => ({
											...form,
											url: event.target.value
										}))
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-hint",
										children: copy.mcpHeaders
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										value: mcpForm.headers ?? "",
										placeholder: "{\"Authorization\":\"Bearer ...\"}",
										onChange: (event) => setMcpForm((form) => ({
											...form,
											headers: event.target.value
										}))
									})] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8,
										padding: "0 14px 12px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn is-primary",
										onClick: () => {
											saveMcp();
										},
										disabled: busy,
										children: copy.mcpSave
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn",
										onClick: () => setMcpForm(null),
										disabled: busy,
										children: copy.importCancel ?? "取消"
									})]
								})
							]
						}) : null,
						tab === "mcp" && !editingMcp ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-mcp-form",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-mcp-form__row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn",
										onClick: () => setMcpForm({
											serverName: "",
											transport: "stdio",
											commandLine: "",
											env: "",
											headers: "",
											url: ""
										}),
										disabled: busy,
										children: `＋ ${copy.mcpNew}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn",
										onClick: () => setMcpImportOpen(true),
										disabled: busy,
										children: copy.mcpImport
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-hint",
										style: {
											alignSelf: "center",
											flex: 1
										},
										children: copy.mcpRestartHint
									})
								]
							})
						}) : null,
						mcpImportOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-combo-backdrop",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-combo",
								style: {
									maxWidth: 560,
									height: "auto",
									maxHeight: "82%"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wf-combo__head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: copy.mcpImport }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn wf-combo__close",
										onClick: () => setMcpImportOpen(false),
										children: "✕"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										padding: "0 14px 12px",
										display: "grid",
										gap: 8
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-hint",
											style: {
												fontSize: 10,
												lineHeight: 1.5,
												color: "var(--wf-ink-2)"
											},
											children: copy.mcpImportHint
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											value: mcpImportText,
											onChange: (event) => setMcpImportText(event.target.value),
											placeholder: "{\"mcpServers\":{\"codegraph\":{\"command\":\"npx\",\"args\":[\"-y\",\"@colbymchenry/codegraph\"]}}}",
											style: {
												minHeight: 150,
												padding: 8,
												borderRadius: 8,
												border: "1px solid var(--wf-border-strong)",
												background: "var(--wf-layer-2)",
												color: "var(--wf-ink)",
												fontFamily: "monospace",
												fontSize: 12
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wf-mcp-form__row",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "wf-btn is-primary",
												onClick: () => {
													importMcpJson();
												},
												disabled: busy,
												children: copy.mcpImportApply
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "wf-btn",
												onClick: () => setMcpImportOpen(false),
												disabled: busy,
												children: copy.importCancel ?? "取消"
											})]
										})
									]
								})]
							})
						}) : null
					]
				})
			});
		}
		//#endregion
		//#region src/client/components/date-picker/DateRangePicker.tsx
		/** 解析 "YYYY-MM-DD"；非法返回 null。 */
		function parseDate(value) {
			if (!value) return null;
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
			if (!match) return null;
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			const probe = new Date(Date.UTC(year, month - 1, day));
			if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
			return {
				year,
				month,
				day
			};
		}
		function fmt(year, month, day) {
			return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
		}
		const DAY_MS = 864e5;
		/** 日期键（UTC 日序号；范围比较用）。 */
		function dayKey(year, month, day) {
			return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
		}
		function todayKey() {
			const now = /* @__PURE__ */ new Date();
			return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
		}
		/**
		* 生成某月视图：首行前导位与前月灰显格、末行补齐位与次月灰显格
		* （与参考素材一致：前后月日号灰显、不可点击）。
		*/
		function buildMonthView(year, month) {
			const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
			const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
			const prevYear = month === 1 ? year - 1 : year;
			const prevMonth = month === 1 ? 12 : month - 1;
			const daysInPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
			const nextYear = month === 12 ? year + 1 : year;
			const nextMonth = month === 12 ? 1 : month + 1;
			const cells = [];
			const total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
			for (let i = 0; i < total; i += 1) {
				const day = i + 1 - firstWeekday;
				if (day < 1) cells.push({
					key: `p:${day}`,
					year: prevYear,
					month: prevMonth,
					day: daysInPrev + day,
					inMonth: false
				});
				else if (day > daysInMonth) cells.push({
					key: `n:${day}`,
					year: nextYear,
					month: nextMonth,
					day: day - daysInMonth,
					inMonth: false
				});
				else cells.push({
					key: `d:${day}`,
					year,
					month,
					day,
					inMonth: true
				});
			}
			return {
				year,
				month,
				cells
			};
		}
		function DateRangePicker({ value, onChange, weekdays, prevLabel, nextLabel }) {
			const today = todayKey();
			const start = parseDate(value.start);
			const end = parseDate(value.end);
			const startKey = start ? dayKey(start.year, start.month, start.day) : null;
			const endKey = end ? dayKey(end.year, end.month, end.day) : null;
			const weekHeader = weekdays ?? [
				"日",
				"一",
				"二",
				"三",
				"四",
				"五",
				"六"
			];
			/** 月偏移（跨年归一）。 */
			const addMonths = (year, month, delta) => {
				const total = year * 12 + (month - 1) + delta;
				return {
					year: Math.floor(total / 12),
					month: (total % 12 + 12) % 12 + 1
				};
			};
			const monthIndex = (p) => p.year * 12 + (p.month - 1);
			/** 左/右月独立导航（右月恒 > 左月）；初始 = 起点所属月 + 次月。 */
			const [range, setRange] = (0, react.useState)(() => {
				const base = start ?? {
					year: (/* @__PURE__ */ new Date()).getFullYear(),
					month: (/* @__PURE__ */ new Date()).getMonth() + 1
				};
				return {
					left: {
						year: base.year,
						month: base.month
					},
					right: addMonths(base.year, base.month, 1)
				};
			});
			const syncedRef = (0, react.useRef)(value.start);
			(0, react.useEffect)(() => {
				if (value.start && value.start !== syncedRef.current) {
					syncedRef.current = value.start;
					const s = parseDate(value.start);
					if (s) {
						const left = {
							year: s.year,
							month: s.month
						};
						setRange((prev) => {
							const nextLeft = left;
							return {
								left: nextLeft,
								right: monthIndex(nextLeft) >= monthIndex(prev.right) ? addMonths(nextLeft.year, nextLeft.month, 1) : prev.right
							};
						});
					}
				}
			}, [value.start]);
			/** 左月翻页：左月移动；若 ≥ 右月则右月跟进为左月+1。 */
			const moveLeft = (delta) => {
				const nextLeft = addMonths(range.left.year, range.left.month, delta);
				const nextRight = monthIndex(nextLeft) >= monthIndex(range.right) ? addMonths(nextLeft.year, nextLeft.month, 1) : range.right;
				setRange({
					left: nextLeft,
					right: nextRight
				});
			};
			/** 右月翻页：右月移动；若 ≤ 左月则钳制为左月+1。 */
			const moveRight = (delta) => {
				let nextRight = addMonths(range.right.year, range.right.month, delta);
				if (monthIndex(nextRight) <= monthIndex(range.left)) nextRight = addMonths(range.left.year, range.left.month, 1);
				setRange({
					left: range.left,
					right: nextRight
				});
			};
			const leftView = (0, react.useMemo)(() => buildMonthView(range.left.year, range.left.month), [range]);
			const rightView = (0, react.useMemo)(() => buildMonthView(range.right.year, range.right.month), [range]);
			const pick = (year, month, day) => {
				const key = dayKey(year, month, day);
				if (startKey === null || endKey !== null) {
					const newStart = fmt(year, month, day);
					syncedRef.current = newStart;
					onChange({
						start: newStart,
						end: null
					});
					return;
				}
				if (key < startKey) {
					const newStart = fmt(year, month, day);
					syncedRef.current = newStart;
					onChange({
						start: newStart,
						end: null
					});
					return;
				}
				onChange({
					start: value.start,
					end: fmt(year, month, day)
				});
			};
			const cellClass = (key, inMonth) => {
				if (!inMonth) return "wf-cal-cell is-dim";
				const classes = ["wf-cal-cell"];
				if (key === today) classes.push("is-today");
				const isStart = startKey === key;
				const isEnd = endKey === key || startKey === key && endKey === null;
				if (isStart) classes.push("is-start");
				if (isEnd) classes.push("is-end");
				return classes.join(" ");
			};
			/** 渲染单个月（带 ‹ › 翻页；left/right 面板各自控制自己的月）。 */
			const renderMonth = (view, move) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wf-cal-month",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-cal-month__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-cal-nav",
								title: prevLabel ?? "上一月",
								onClick: () => move(-1),
								children: "‹"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-cal-month__title",
								children: `${view.year}年${view.month}月`
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-cal-nav",
								title: nextLabel ?? "下一月",
								onClick: () => move(1),
								children: "›"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-cal-grid",
						children: weekHeader.map((label) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-cal-week",
							children: label
						}, label))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-cal-grid",
						children: view.cells.map((cell) => {
							const key = dayKey(cell.year, cell.month, cell.day);
							const isStart = cell.inMonth && startKey === key;
							const isEnd = cell.inMonth && (endKey === key || startKey === key && endKey === null);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: cellClass(key, cell.inMonth),
								disabled: !cell.inMonth,
								onClick: () => pick(cell.year, cell.month, cell.day),
								tabIndex: cell.inMonth ? 0 : -1,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-cal-cell__num",
										children: cell.day
									}),
									isStart ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-cal-cell__tag",
										children: "开始"
									}) : null,
									isEnd ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-cal-cell__tag",
										children: "结束"
									}) : null
								]
							}, cell.key);
						})
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wf-cal",
				children: [renderMonth(leftView, moveLeft), renderMonth(rightView, moveRight)]
			});
		}
		//#endregion
		//#region src/client/components/time-input/TimeInput.tsx
		/** 解析 "HH:mm" / "H:mm" / "HHmm" / "Hmm"/ "HH" / "H" → {hour, minute}（非法 null）。 */
		function parseTimeText(text) {
			const raw = String(text ?? "").trim();
			if (!raw) return null;
			const colon = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
			if (colon) {
				const hour = Number(colon[1]);
				const minute = Number(colon[2]);
				if (hour <= 23 && minute <= 59) return {
					hour,
					minute
				};
				return null;
			}
			if (!/^\d{1,4}$/.test(raw)) return null;
			const digits = raw;
			if (digits.length === 1) return {
				hour: Number(digits),
				minute: 0
			};
			if (digits.length === 2) {
				const two = Number(digits);
				if (two <= 23) return {
					hour: two,
					minute: 0
				};
				return {
					hour: Number(digits[0]),
					minute: Number(digits[1])
				};
			}
			if (digits.length === 3) {
				const hour = Number(digits[0]);
				const minute = Number(digits.slice(1));
				if (hour <= 23 && minute <= 59) return {
					hour,
					minute
				};
				return null;
			}
			const hour = Number(digits.slice(0, 2));
			const minute = Number(digits.slice(2));
			if (hour <= 23 && minute <= 59) return {
				hour,
				minute
			};
			return null;
		}
		/** 按位输入时的渐进格式化（键入 1125 → 11:25；键入 112 → 11:2；键入 925 → 9:25；键入 9 → 9）。 */
		function formatTimeBuffer(digits) {
			if (!digits) return "";
			if (digits.length <= 2) {
				const asHour = Number(digits);
				if (digits.length === 2 && asHour > 23) return `${digits[0]}:${digits[1]}`;
				return digits;
			}
			if (digits.length === 3) return Number(digits.slice(0, 2)) <= 23 ? `${digits.slice(0, 2)}:${digits[2]}` : `${digits[0]}:${digits.slice(1)}`;
			return `${digits.slice(0, 2)}:${digits.slice(2)}`;
		}
		/** 归一化显示 "HH:mm"。 */
		function pad2(num) {
			return String(num).padStart(2, "0");
		}
		/** 时/分候选列表（0..23 / 0..59，两位显示）。 */
		const HOURS = Array.from({ length: 24 }, (_, i) => i);
		const MINUTES = Array.from({ length: 60 }, (_, i) => i);
		function TimeInput({ value, onChange, placeholder, ariaLabel }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [pendingHour, setPendingHour] = (0, react.useState)(null);
			const [pendingMinute, setPendingMinute] = (0, react.useState)(null);
			const [text, setText] = (0, react.useState)(value);
			const focusedRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (!focusedRef.current) setText(value);
			}, [value]);
			const commit = (0, react.useCallback)((next) => {
				onChange(next);
				setText(next);
				setOpen(false);
				setPendingHour(null);
				setPendingMinute(null);
			}, [onChange]);
			const handleTextChange = (0, react.useCallback)((raw) => {
				let digits = raw;
				if (raw.includes(":")) {
					setText(raw);
					return;
				}
				digits = raw.replace(/\D/g, "").slice(0, 4);
				setText(formatTimeBuffer(digits));
			}, []);
			const commitText = (0, react.useCallback)(() => {
				const parsed = parseTimeText(text);
				if (parsed) {
					onChange(`${pad2(parsed.hour)}:${pad2(parsed.minute)}`);
					setText(`${pad2(parsed.hour)}:${pad2(parsed.minute)}`);
				} else setText(value);
			}, [
				text,
				value,
				onChange
			]);
			const openPicker = (0, react.useCallback)(() => {
				setOpen((current) => {
					const next = !current;
					if (next) {
						setPendingHour(null);
						setPendingMinute(null);
					}
					return next;
				});
			}, []);
			const pickHour = (0, react.useCallback)((hour) => {
				setPendingHour(hour);
			}, []);
			const pickMinute = (0, react.useCallback)((minute) => {
				setPendingMinute(minute);
			}, []);
			(0, react.useEffect)(() => {
				if (open && pendingHour !== null && pendingMinute !== null) commit(`${pad2(pendingHour)}:${pad2(pendingMinute)}`);
			}, [
				open,
				pendingHour,
				pendingMinute,
				commit
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "wf-time",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "text",
						className: "wf-time__field",
						value: text,
						placeholder: placeholder ?? "HH:mm",
						"aria-label": ariaLabel,
						inputMode: "numeric",
						onFocus: () => {
							focusedRef.current = true;
						},
						onChange: (event) => handleTextChange(event.target.value),
						onBlur: () => {
							focusedRef.current = false;
							commitText();
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitText();
							} else if (event.key === "Escape") {
								setOpen(false);
								setPendingHour(null);
								setPendingMinute(null);
							}
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "wf-time__clock",
						title: ariaLabel ?? "选择时间",
						onClick: openPicker,
						children: "🕑"
					}),
					open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "wf-time__picker",
						role: "listbox",
						"aria-label": ariaLabel ?? "选择时间",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-time__col",
							role: "listbox",
							"aria-label": "时",
							children: HOURS.map((hour) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "option",
								"aria-selected": pendingHour === hour,
								className: `wf-time__opt${pendingHour === hour ? " is-active" : ""}`,
								onClick: () => pickHour(hour),
								children: pad2(hour)
							}, `h:${hour}`))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "wf-time__col",
							role: "listbox",
							"aria-label": "分",
							children: MINUTES.map((minute) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "option",
								"aria-selected": pendingMinute === minute,
								className: `wf-time__opt${pendingMinute === minute ? " is-active" : ""}`,
								onClick: () => pickMinute(minute),
								children: pad2(minute)
							}, `m:${minute}`))
						})]
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/components/scheduler/scheduler-utils.ts
		/** 本地时区（浏览器/Node resolvedOptions；不可用时回退 Asia/Shanghai）。 */
		function detectLocalTimezone() {
			try {
				return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
			} catch {
				return "Asia/Shanghai";
			}
		}
		/** 本地日期 "YYYY-MM-DD"（今天）。 */
		function localDateOnly(date = /* @__PURE__ */ new Date()) {
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		}
		/** 日期偏移（"YYYY-MM-DD"）。 */
		function shiftDateOnly(dateOnly, days) {
			const [y, m, d] = dateOnly.split("-").map(Number);
			const utc = Date.UTC(y, m - 1, d) + days * 864e5;
			return localDateOnly(new Date(utc));
		}
		/** 任务 id 生成（`task-` 前缀；与组合 combo- 模式一致）。 */
		function newTaskId() {
			return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		}
		/** 空任务草稿（默认值：今天起 30 天、每天、一个 09:00–18:00 时间段、定点触发 09:00）。 */
		function createTaskDraft(ownerSessionId, now = /* @__PURE__ */ new Date()) {
			const today = localDateOnly(now);
			return {
				taskId: newTaskId(),
				name: "",
				workflowTemplateId: "",
				sessionMode: "new-session",
				ownerSessionId,
				enabled: true,
				timezone: detectLocalTimezone(),
				window: {
					startDate: today,
					endDate: shiftDateOnly(today, 30),
					daysOfWeek: [],
					timeRanges: [{
						start: "09:00",
						end: "18:00"
					}]
				},
				triggerMode: "daily_time",
				dailyTimeConfig: { timePoints: ["09:00"] },
				intervalConfig: {
					intervalMinutes: 120,
					startFrom: "09:00"
				},
				runtimePolicy: {
					missedTrigger: "skip",
					concurrency: "skip",
					configUpdate: "immediate"
				},
				createdAt: now.toISOString(),
				updatedAt: now.toISOString()
			};
		}
		/** 视图 → 草稿（深拷贝，避免表单编辑污染列表数据）。 */
		function taskFromView(view) {
			return JSON.parse(JSON.stringify(view.task));
		}
		/** 表单即时校验：返回第一处错误消息（null = 通过基础检查）。 */
		function validateTaskDraft(task) {
			if (!String(task.name ?? "").trim()) return "schedulerNeedName";
			if (!String(task.workflowTemplateId ?? "").trim()) return "schedulerNeedTemplate";
			return null;
		}
		/** 显示格式化：ISO → 本地可读（含时区标识）。 */
		function formatIso(value) {
			if (!value) return "—";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return String(value);
			try {
				return new Intl.DateTimeFormat("zh-CN", {
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit"
				}).format(date);
			} catch {
				return date.toLocaleString();
			}
		}
		/** 星期标签（0=周日 … 6=周六）。 */
		const WEEKDAY_LABELS = [
			"日",
			"一",
			"二",
			"三",
			"四",
			"五",
			"六"
		];
		//#endregion
		//#region src/client/components/scheduler/SchedulerManager.tsx
		/** 时区建议列表（UI 下拉用；权威校验在 host）。 */
		const TIMEZONE_SUGGESTIONS = [
			"Asia/Shanghai",
			"Asia/Hong_Kong",
			"Asia/Tokyo",
			"Asia/Singapore",
			"Asia/Seoul",
			"Asia/Taipei",
			"Asia/Kolkata",
			"Europe/London",
			"Europe/Paris",
			"Europe/Berlin",
			"America/New_York",
			"America/Chicago",
			"America/Los_Angeles",
			"America/Sao_Paulo",
			"Australia/Sydney",
			"UTC"
		];
		/** 表单行（标签 + 子元素）。 */
		function Field({ label, children, hint }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "wf-sched-field",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-sched-field__label",
						children: label
					}),
					children,
					hint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "wf-sched-field__hint",
						children: hint
					}) : null
				]
			});
		}
		function SchedulerManager({ copy, remote, sessionId, onClose, onToast }) {
			const [views, setViews] = (0, react.useState)([]);
			const [templates, setTemplates] = (0, react.useState)([]);
			const [activeTaskId, setActiveTaskId] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(false);
			const [calendarOpen, setCalendarOpen] = (0, react.useState)(false);
			const loadedRef = (0, react.useRef)(false);
			const load = (0, react.useCallback)(async () => {
				try {
					const [viewsData, templatesData] = await Promise.all([remote.call(EP_SCHEDULER_TASKS).catch(() => []), remote.call(EP_LIST_FLOW_TEMPLATES).catch(() => [])]);
					const items = Array.isArray(viewsData) ? viewsData : [];
					const tpls = (Array.isArray(templatesData) ? templatesData : []).filter((item) => item.mode === "mode1");
					setViews(items);
					setTemplates(tpls);
					setActiveTaskId((current) => {
						if (current && items.some((item) => item.task.taskId === current)) return current;
						const first = items[0];
						if (first) {
							setDraft(taskFromView(first));
							return first.task.taskId;
						}
						return current;
					});
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				}
			}, [remote, onToast]);
			(0, react.useEffect)(() => {
				if (loadedRef.current) return;
				loadedRef.current = true;
				load();
			}, [load]);
			const activeView = (0, react.useMemo)(() => views.find((item) => item.task.taskId === activeTaskId) ?? null, [views, activeTaskId]);
			/** 任务列表项展示元信息（模板名 + 下次触发）。 */
			const itemMeta = (0, react.useCallback)((view) => {
				const parts = [templates.find((item) => item.id === view.task.workflowTemplateId)?.name ?? view.task.workflowTemplateId];
				if (view.runtime.nextTriggerAt) parts.push(`${copy.schedulerNextRun} ${formatIso(view.runtime.nextTriggerAt)}`);
				return parts.join(" · ");
			}, [templates, copy.schedulerNextRun]);
			const selectTask = (0, react.useCallback)((id) => {
				setActiveTaskId(id);
				setConfirmDelete(false);
				setCalendarOpen(false);
				const view = views.find((item) => item.task.taskId === id);
				if (view) setDraft(taskFromView(view));
			}, [views]);
			const newTask = (0, react.useCallback)(() => {
				const draftTask = createTaskDraft(sessionId);
				setActiveTaskId(draftTask.taskId);
				setDraft(draftTask);
				setConfirmDelete(false);
				setCalendarOpen(false);
			}, [sessionId]);
			const patch = (0, react.useCallback)((part) => {
				setDraft((current) => current ? {
					...current,
					...part
				} : current);
			}, []);
			const patchWindow = (0, react.useCallback)((part) => {
				setDraft((current) => current ? {
					...current,
					window: {
						...current.window,
						...part
					}
				} : current);
			}, []);
			const saveTask = (0, react.useCallback)(async () => {
				if (!draft) return;
				const validation = validateTaskDraft(draft);
				if (validation !== null) {
					onToast("error", String(copy[validation] ?? validation));
					return;
				}
				setBusy(true);
				try {
					const saved = await remote.call(EP_SCHEDULER_TASK_PUT, { task: draft });
					await load();
					setActiveTaskId(saved.taskId);
					onToast("success", copy.schedulerSaved);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				copy,
				draft,
				load,
				onToast,
				remote
			]);
			const deleteTask = (0, react.useCallback)(async () => {
				if (!activeTaskId) return;
				if (!confirmDelete) {
					setConfirmDelete(true);
					return;
				}
				setConfirmDelete(false);
				setBusy(true);
				try {
					await remote.call(EP_SCHEDULER_TASK_DELETE, { taskId: activeTaskId });
					setActiveTaskId(null);
					setDraft(null);
					await load();
					onToast("success", copy.schedulerDeleted);
				} catch (error) {
					onToast("error", String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			}, [
				activeTaskId,
				confirmDelete,
				copy.schedulerDeleted,
				load,
				onToast,
				remote
			]);
			/** 星期切换（0=周日 … 6=周六）。 */
			const toggleDay = (0, react.useCallback)((day) => {
				setDraft((current) => {
					if (!current) return current;
					const days = current.window.daysOfWeek ?? [];
					const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
					return {
						...current,
						window: {
							...current.window,
							daysOfWeek: next
						}
					};
				});
			}, []);
			const patchRange = (0, react.useCallback)((index, part) => {
				setDraft((current) => {
					if (!current) return current;
					const ranges = current.window.timeRanges.map((range, i) => i === index ? {
						...range,
						...part
					} : range);
					return {
						...current,
						window: {
							...current.window,
							timeRanges: ranges
						}
					};
				});
			}, []);
			const addRange = (0, react.useCallback)(() => {
				setDraft((current) => current ? {
					...current,
					window: {
						...current.window,
						timeRanges: [...current.window.timeRanges, {
							start: "09:00",
							end: "18:00"
						}]
					}
				} : current);
			}, []);
			const removeRange = (0, react.useCallback)((index) => {
				setDraft((current) => current ? {
					...current,
					window: {
						...current.window,
						timeRanges: current.window.timeRanges.filter((_, i) => i !== index)
					}
				} : current);
			}, []);
			const patchTimePoint = (0, react.useCallback)((index, value) => {
				setDraft((current) => {
					if (!current) return current;
					const points = [...current.dailyTimeConfig?.timePoints ?? []];
					points[index] = value;
					const sorted = points.sort((a, b) => a.localeCompare(b));
					return {
						...current,
						dailyTimeConfig: { timePoints: sorted }
					};
				});
			}, []);
			const addTimePoint = (0, react.useCallback)(() => {
				setDraft((current) => current ? {
					...current,
					dailyTimeConfig: { timePoints: [...current.dailyTimeConfig?.timePoints ?? [], "09:00"] }
				} : current);
			}, []);
			const removeTimePoint = (0, react.useCallback)((index) => {
				setDraft((current) => {
					if (!current) return current;
					const points = (current.dailyTimeConfig?.timePoints ?? []).filter((_, i) => i !== index);
					return {
						...current,
						dailyTimeConfig: { timePoints: points }
					};
				});
			}, []);
			const timezones = (0, react.useMemo)(() => {
				const list = [...TIMEZONE_SUGGESTIONS];
				const local = detectLocalTimezone();
				if (!list.includes(local)) list.unshift(local);
				return list;
			}, []);
			const tzOptions = (0, react.useMemo)(() => timezones.map((tz) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
				value: tz,
				children: tz
			}, tz)), [timezones]);
			/** 日期不限开关：true = 忽略日期范围（仅 daysOfWeek + timeRanges）；关闭时补默认范围。 */
			const unbounded = draft?.window?.unbounded === true;
			const toggleUnbounded = (0, react.useCallback)(() => {
				setDraft((current) => {
					if (!current) return current;
					const next = !(current.window.unbounded === true);
					const window = {
						...current.window,
						unbounded: next
					};
					if (!next && !window.startDate && !window.endDate) {
						const today = localDateOnly();
						window.startDate = today;
						window.endDate = shiftDateOnly(today, 30);
					}
					return {
						...current,
						window
					};
				});
			}, []);
			/** 日期范围（把空串视为"未定" → null，使日历能在"仅起点"状态下继续点选终点）。 */
			const dateRangeValue = {
				start: draft?.window.startDate || null,
				end: draft?.window.endDate || null
			};
			const statusText = (key) => String(copy.schedulerStatus[key] ?? key ?? "");
			const resultText = (key) => key ? String(copy.schedulerLastResult[key] ?? key) : "—";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "wf-combo-backdrop",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "wf-combo wf-sched",
					role: "dialog",
					"aria-modal": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-combo__head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: copy.schedulerManager }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-status",
								children: copy.schedulerHint
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn wf-combo__close",
								onClick: onClose,
								children: "✕"
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-combo__body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-sched__form",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-sched__form-scroll",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: copy.schedulerTemplate,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: draft?.workflowTemplateId ?? "",
											onChange: (event) => patch({ workflowTemplateId: event.target.value }),
											disabled: !draft,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: templates.length === 0 ? copy.schedulerTemplateEmpty : copy.schedulerTemplatePlaceholder
											}), templates.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: item.id,
												children: item.name ?? item.id
											}, item.id))]
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: copy.schedulerName,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: draft?.name ?? "",
											placeholder: copy.schedulerName,
											onChange: (event) => patch({ name: event.target.value }),
											disabled: !draft
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
										label: copy.schedulerSessionMode,
										hint: draft?.sessionMode === "current-session" ? copy.schedulerSessionCurrentHint : copy.schedulerSessionNewHint,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wf-sched-radios",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: "wf-sched-radio",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "radio",
													name: "sched-session",
													checked: draft?.sessionMode === "new-session",
													disabled: !draft,
													onChange: () => patch({ sessionMode: "new-session" })
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.schedulerSessionNew })]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: "wf-sched-radio",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "radio",
													name: "sched-session",
													checked: draft?.sessionMode === "current-session",
													disabled: !draft,
													onChange: () => patch({ sessionMode: "current-session" })
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.schedulerSessionCurrent })]
											})]
										}), draft?.sessionMode === "new-session" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "text",
											className: "wf-sched-workspace",
											value: String(draft.workspacePath ?? ""),
											placeholder: copy.workspacePlaceholder,
											title: copy.workspaceHint,
											onChange: (event) => patch({ workspacePath: event.target.value.trim() || void 0 }),
											disabled: !draft
										}) : null]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: copy.schedulerTimezone,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											value: draft?.timezone ?? "",
											onChange: (event) => patch({ timezone: event.target.value }),
											disabled: !draft,
											children: tzOptions
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "wf-sched-group",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h5", { children: copy.schedulerWindow }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wf-sched-field__hint",
												children: copy.schedulerWindowHint
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: `${copy.schedulerWindowDates}（${copy.schedulerWindowDateStart} ~ ${copy.schedulerWindowDateEnd}）`,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wf-sched-dates",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "text",
															readOnly: true,
															value: draft ? unbounded ? copy.schedulerWindowUnbounded : `${draft.window.startDate || "…"} ~ ${draft.window.endDate || "…"}` : "",
															placeholder: copy.schedulerWindowDaysAll
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: `wf-btn${unbounded ? " is-primary" : ""}`,
															title: copy.schedulerWindowUnbounded,
															onClick: toggleUnbounded,
															disabled: !draft,
															children: copy.schedulerWindowUnbounded
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "wf-btn",
															onClick: () => setCalendarOpen((open) => !open),
															disabled: !draft || unbounded,
															children: calendarOpen ? "▾" : "📅"
														})
													]
												})
											}),
											calendarOpen && draft && !unbounded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "wf-cal-card",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DateRangePicker, {
													value: dateRangeValue,
													onChange: (value) => patchWindow({
														startDate: value.start ?? "",
														endDate: value.end ?? ""
													})
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "wf-cal-card__foot",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn is-primary",
														onClick: () => setCalendarOpen(false),
														children: copy.inspectorSave
													})
												})]
											}) : null,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: copy.schedulerWindowDays,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wf-sched-days",
													children: [WEEKDAY_LABELS.map((label, day) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: `wf-sched-day${(draft?.window.daysOfWeek ?? []).includes(day) ? " is-active" : ""}`,
														onClick: () => toggleDay(day),
														disabled: !draft,
														children: label
													}, label)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: `wf-sched-day is-all${(draft?.window.daysOfWeek ?? []).length === 0 ? " is-active" : ""}`,
														onClick: () => patchWindow({ daysOfWeek: [] }),
														disabled: !draft,
														children: copy.schedulerWindowDaysAll
													})]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: copy.schedulerWindowRanges,
												hint: copy.schedulerRangeCrossHint,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wf-sched-ranges",
													children: [(draft?.window.timeRanges ?? []).map((range, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wf-sched-range-row",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TimeInput, {
																value: range.start,
																onChange: (value) => patchRange(index, { start: value }),
																ariaLabel: copy.schedulerRangeStart
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "~" }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TimeInput, {
																value: range.end,
																onChange: (value) => patchRange(index, { end: value }),
																ariaLabel: copy.schedulerRangeEnd
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																className: "wf-btn wf-iconbtn",
																title: copy.inspectorDelete,
																onClick: () => removeRange(index),
																children: "×"
															})
														]
													}, `${index}:${range.start}-${range.end}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn is-ghost",
														onClick: addRange,
														disabled: !draft,
														children: `＋ ${copy.schedulerRangeAdd}`
													})]
												})
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "wf-sched-group",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h5", { children: copy.schedulerTrigger }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "wf-sched-radios",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: "wf-sched-radio",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "radio",
														name: "sched-trigger",
														checked: draft?.triggerMode === "daily_time",
														disabled: !draft,
														onChange: () => patch({ triggerMode: "daily_time" })
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.schedulerTriggerDaily })]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
													className: "wf-sched-radio",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "radio",
														name: "sched-trigger",
														checked: draft?.triggerMode === "interval",
														disabled: !draft,
														onChange: () => patch({ triggerMode: "interval" })
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.schedulerTriggerInterval })]
												})]
											}),
											draft?.triggerMode === "daily_time" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: copy.schedulerTimePoints,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "wf-sched-ranges",
													children: [(draft.dailyTimeConfig?.timePoints ?? []).map((point, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "wf-sched-range-row",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TimeInput, {
															value: point,
															onChange: (value) => patchTimePoint(index, value),
															ariaLabel: copy.schedulerTimePoints
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: "wf-btn wf-iconbtn",
															title: copy.inspectorDelete,
															onClick: () => removeTimePoint(index),
															children: "×"
														})]
													}, `${index}:${point}`)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "wf-btn is-ghost",
														onClick: addTimePoint,
														disabled: !draft,
														children: `＋ ${copy.schedulerTimePointAdd}`
													})]
												})
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "wf-sched-row2",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
													label: copy.schedulerInterval,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "number",
														min: 1,
														max: 1439,
														step: 1,
														value: draft?.intervalConfig?.intervalMinutes ?? 120,
														onChange: (event) => patch({ intervalConfig: {
															...draft?.intervalConfig ?? {
																intervalMinutes: 120,
																startFrom: "09:00"
															},
															intervalMinutes: Number(event.target.value) || 120
														} }),
														disabled: !draft
													})
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
													label: copy.schedulerIntervalStartFrom,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TimeInput, {
														value: draft?.intervalConfig?.startFrom ?? "09:00",
														onChange: (value) => patch({ intervalConfig: {
															...draft?.intervalConfig ?? {
																intervalMinutes: 120,
																startFrom: "09:00"
															},
															startFrom: value
														} }),
														ariaLabel: copy.schedulerIntervalStartFrom
													})
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "wf-sched-field__hint",
												children: copy.schedulerIntervalHint
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "wf-sched-group",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h5", { children: copy.schedulerPolicy }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-sched-field__hint",
											children: copy.schedulerPolicyText
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
										className: "wf-sched-group",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h5", { children: copy.schedulerCurrentRun }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "wf-sched-status-grid",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "wf-sched-status-cell",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `wf-sched-dot is-${activeView?.runtime.status ?? "idle"}` }), statusText(activeView?.runtime.status ?? "idle")]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wf-sched-status-cell",
													children: `${copy.schedulerNextRun}：${formatIso(activeView?.runtime.nextTriggerAt ?? null)}`
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wf-sched-status-cell",
													children: `${copy.schedulerLastOutcome}：${resultText(activeView?.runtime.lastResult ?? null)}`
												}),
												activeView?.runtime.lastError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "wf-sched-status-cell is-error",
													children: activeView.runtime.lastError
												}) : null
											]
										})]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-sched__form-foot",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wf-btn is-danger",
									onClick: () => {
										deleteTask();
									},
									disabled: !activeTaskId || busy,
									children: confirmDelete ? copy.schedulerDeleteConfirm : copy.schedulerDelete
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "wf-btn is-primary",
									onClick: () => {
										saveTask();
									},
									disabled: !draft || busy,
									children: copy.inspectorSave
								})]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "wf-combo__side",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wf-combo__side-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: copy.scheduler }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-btn",
										onClick: newTask,
										disabled: busy,
										children: `＋ ${copy.schedulerNew}`
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wf-combo__side-list",
									children: views.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "wf-hint",
										children: copy.schedulerEmpty
									}) : views.map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: `wf-combo-item${view.task.taskId === activeTaskId ? " is-active" : ""}`,
										onClick: () => selectTask(view.task.taskId),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "wf-combo-item__label",
											children: view.task.name
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "wf-sched-list-meta",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `wf-sched-dot is-${view.runtime.status}`,
												title: statusText(view.runtime.status)
											}), itemMeta(view)]
										})]
									}, view.task.taskId))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "wf-combo-hint",
									children: copy.schedulerDeleteHint
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "wf-sched-enabled",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: draft?.enabled === true,
										disabled: !draft,
										onChange: (event) => patch({ enabled: event.target.checked })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.schedulerEnabled })]
								})
							]
						})]
					})]
				})
			});
		}
		//#endregion
		//#region src/client/studio/StudioLayout.tsx
		/** 工作台渲染层（纯 JSX 组合；回调/数据全部来自 props）。 */
		function StudioLayout(props) {
			const { t, state, sessionId, remote, onClose, onTitlebarDrag, currentFlow, currentService, currentFlowTemplate, editorData, edgeList, stageKinds, parentTemplate, roleTemplates, groupTemplates, toolbarRunning, runStatusByNode, highlightedNodeIds, modeName, canvasApiRef, canvasShellRef, libraryImportRef, personaInputRef, groupMdInputRef, dispatch, doc, canvas, editor, run, transfer, selection, history, guard, panels, toast, beginLibraryDrag, dragPreview, dropGroupId, modeMenuOpen, setModeMenuOpen, switchMode, requestClose, canvasCaption, leftOpen, bottomOpen, inspectorOpen, onToggleView, handleRun, panelsCollapsed, onTogglePanels } = props;
			const libraryProps = {
				libTab: state.libTab,
				onSetTab: (tab) => dispatch({
					type: "SET_LIB_TAB",
					tab
				}),
				mode: state.mode,
				currentSessionId: state.sessionId,
				workflows: (state.mode === "mode2" ? state.services : state.workflows).map((item) => {
					const active = state.activeRuns.find((a) => a.flowId === item.id && a.sessionId === item.sessionId);
					const currentSnapshot = state.run.runId !== null && state.run.snapshot?.flowId === item.id ? state.run.snapshot.status : null;
					return {
						id: item.id,
						name: item.name,
						description: item.description,
						nodes: item.nodes,
						sessionId: item.sessionId,
						runStatus: currentSnapshot ?? active?.status ?? null
					};
				}),
				flowTemplates: (state.flowTemplates ?? []).filter((item) => item.mode === state.mode),
				parentTemplate,
				roleTemplates,
				fileTemplates: state.templates.file,
				databaseTemplates: state.templates.database,
				groupTemplates,
				stageKinds,
				libSelection: state.selection.lib,
				modeName,
				onSelectWorkflow: doc.selectWorkflow,
				onSelectFlowTemplate: doc.selectFlowTemplate,
				onSelectLib: editor.selectLibraryCard,
				onPlaceTemplate: canvas.placeTemplateNode,
				onPlaceTemplateIntoGroup: canvas.placeTemplateIntoGroup,
				onPlaceStage: canvas.placeStageNode,
				onPlaceGroup: canvas.placeGroupNode,
				onPlaceGroupFromTemplate: canvas.placeGroupFromTemplate,
				onPlaceParent: canvas.placeParentNode,
				onCreateNew: doc.createNew,
				onBeginDrag: beginLibraryDrag
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "wf-root",
				"data-wf-immersive": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "wf-tabs",
						"data-wf-titlebar": "",
						onPointerDown: onTitlebarDrag,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-titlebar__title",
								children: t.studio
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-titlebar__badge",
								children: t.badge
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "wf-titlebar__note",
								children: t.note
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wf-titlebar__spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: libraryImportRef,
								type: "file",
								accept: ".json,application/json",
								className: "wf-import-hidden",
								onChange: (event) => {
									transfer.handleImportFile(event.target.files?.[0] ?? null);
									event.target.value = "";
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: personaInputRef,
								type: "file",
								accept: ".md,.markdown",
								className: "wf-import-hidden",
								onChange: (event) => {
									transfer.onPersonaMdSelected(event.target.files?.[0] ?? null);
									event.target.value = "";
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: groupMdInputRef,
								type: "file",
								accept: ".md,.markdown",
								className: "wf-import-hidden",
								onChange: (event) => {
									transfer.onGroupMdSelected(event.target.files?.[0] ?? null);
									event.target.value = "";
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn is-ghost",
								onClick: () => libraryImportRef.current?.click(),
								children: t.importWorkflow
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn is-ghost",
								onClick: () => {
									transfer.exportCurrent();
								},
								children: t.exportWorkflow
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-titlebar__mode",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "wf-btn",
									onClick: () => setModeMenuOpen((open) => !open),
									children: [state.mode === "mode2" ? t.mode2 : t.mode1, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "wf-titlebar__caret",
										children: "▾"
									})]
								}), modeMenuOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "wf-mode-menu",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-mode-menu__item",
										onClick: () => {
											setModeMenuOpen(false);
											switchMode("mode1");
										},
										children: t.mode1
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "wf-mode-menu__item",
										onClick: () => {
											setModeMenuOpen(false);
											switchMode("mode2");
										},
										children: t.mode2
									})]
								}) : null]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn",
								title: t.scheduler,
								onClick: () => dispatch({
									type: "SCHEDULER_OPEN",
									open: true
								}),
								children: t.scheduler
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn",
								title: t.combos,
								onClick: () => dispatch({
									type: "COMBO_OPEN",
									open: true
								}),
								children: t.combos
							}),
							onToggleView ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn wf-iconbtn wf-titlebar__view",
								title: t.toggleWindow,
								"aria-label": t.toggleWindow,
								onClick: onToggleView,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
									viewBox: "0 0 24 24",
									width: "15",
									height: "15",
									"aria-hidden": "true",
									style: { color: "currentColor" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										d: "M9 4v16M4 4h16v16H4z"
									})
								})
							}) : null,
							onClose ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "wf-btn wf-iconbtn wf-titlebar__close",
								title: t.windowClose,
								"aria-label": t.windowClose,
								onClick: requestClose,
								children: "✕"
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
						className: "wf-main",
						"data-wf-main": "",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LeftPanel, {
								copy: t,
								...libraryProps,
								open: leftOpen,
								width: state.panels.leftWidth
							}),
							leftOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wf-splitter",
								role: "separator",
								"aria-orientation": "vertical",
								onPointerDown: (event) => panels.beginResize("left", event)
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "wf-canvas-shell",
								ref: canvasShellRef,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toolbar, {
										copy: t,
										mode: state.mode,
										panelsCollapsed,
										onTogglePanels,
										saveLabel: state.currentKind === "flowTemplate" ? state.mode === "mode2" ? t.createService : t.createInstance : state.mode === "mode2" ? t.saveServiceInstance : t.saveInstance,
										onUndo: history.undo,
										onRedo: history.redo,
										onClear: canvas.clearGraph,
										canClear: state.canvas.nodes.length > 0,
										onTidy: canvas.tidyGraph,
										canTidy: state.canvas.nodes.length > 0,
										onSave: () => {
											state.currentKind === "flowTemplate" ? doc.createInstanceFromCanvas() : doc.saveCanvas();
										},
										canSave: Boolean(state.currentId),
										running: toolbarRunning,
										onStop: () => {
											state.mode === "mode2" ? run.stopService() : run.stopRun();
										},
										onRun: () => {
											handleRun();
										},
										onOpenHistory: () => {
											run.openHistory();
										},
										canHistory: state.mode === "mode1" && Boolean(currentFlow),
										serviceStatus: state.mode === "mode2" ? {
											port: currentService?.port,
											status: currentService?.status
										} : null,
										showNewSession: state.currentKind === "flowTemplate",
										instanceOptions: state.instanceOptions,
										onInstanceOptionsChange: (patch) => dispatch({
											type: "INSTANCE_OPTIONS_SET",
											options: patch
										})
									}),
									state.mode === "mode2" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServiceConsole, {
										copy: t,
										service: currentService,
										sessionId: currentService?.sessionId ?? sessionId,
										busy: state.run.runId !== null
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GraphCanvas, {
										nodes: state.canvas.nodes,
										edges: edgeList,
										copy: {
											...t,
											modeName
										},
										mode: state.mode,
										selectedNode: state.selection.nodeId,
										selectedEdge: state.selection.edgeId,
										runStatusByNode,
										highlightedNodeIds,
										onInit: (api) => {
											canvasApiRef.current = api;
										},
										onNodeDragStart: canvas.onNodeDragStart,
										onNodeMove: canvas.moveNode,
										onNodeDropToGroup: canvas.addNodeToGroup,
										onNodeSelect: (id) => selection.selectNode(id),
										onEdgeSelect: (id) => selection.selectEdge(id),
										onPaneClick: () => selection.clearSelection(),
										onConnect: canvas.onConnect,
										onConnectionRejected: canvas.onConnectionRejected,
										onGroupResize: canvas.onGroupResize,
										onSwapPorts: canvas.swapNodePorts,
										dropTargetGroupId: dropGroupId,
										fitLabel: t.fitView,
										zoomInLabel: t.zoomIn,
										zoomOutLabel: t.zoomOut,
										emptyHint: t.emptyHint,
										workflowCaption: canvasCaption
									})
								]
							}),
							inspectorOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "wf-splitter",
								role: "separator",
								"aria-orientation": "vertical",
								onPointerDown: (event) => panels.beginResize("right", event)
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Inspector, {
								copy: t,
								open: inspectorOpen,
								width: state.panels.rightWidth,
								editorData,
								presets: state.presets,
								tools: state.tools,
								models: state.models,
								combos: state.combos,
								flowMeta: {
									nodeCount: state.canvas.nodes.length,
									revision: Number((currentFlow ?? currentService)?.revision ?? 0)
								},
								onPatch: editor.patchEditor,
								onDelete: () => {
									editor.deleteEditor();
								},
								onSave: () => {
									editor.saveEditor();
								},
								onSaveAsTemplate: () => {
									doc.saveCurrentAsFlowTemplate();
								},
								onCopyProxy: canvas.copyToProxy,
								onRemoveMember: canvas.removeGroupMember,
								onFileSelect: (files) => {
									transfer.onFileSelect(files);
								},
								onLoadMd: () => {
									transfer.loadPersonaMd();
								},
								onLoadGroupMd: () => {
									transfer.loadGroupMd();
								},
								onTestDb: () => {
									transfer.testDbConnection();
								},
								saveDisabled: toolbarRunning,
								importBusy: false
							})
						]
					}),
					bottomOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "wf-bottom-area",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "wf-splitter wf-splitter--horizontal",
							role: "separator",
							"aria-orientation": "horizontal",
							onPointerDown: (event) => panels.beginResize("bottom", event)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BottomPanel, {
							copy: t,
							...libraryProps,
							open: bottomOpen,
							height: state.panels.bottomHeight
						})]
					}) : null,
					state.message ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-message",
						children: state.message
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						confirm: state.confirm,
						copy: t,
						onClose: () => dispatch({
							type: "CONFIRM_SET",
							confirm: null
						}),
						onSaveAndProceed: () => {
							guard.saveAndProceed(() => doc.saveCanvas());
						},
						onDiscardAndProceed: guard.discardAndProceed,
						onResolveImport: (mode) => {
							transfer.resolveImportConflict(mode);
						}
					}),
					state.historyOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunHistory, {
						history: state.runHistory,
						selectedRunId: state.selectedRunId,
						copy: t,
						onSelect: (id) => dispatch({
							type: "RUN_HISTORY_SELECT",
							id
						}),
						onClose: () => dispatch({
							type: "HISTORY_OPEN",
							open: false
						}),
						onResume: (runId) => {
							run.resumeRun(runId);
						},
						canResume: state.mode === "mode1"
					}) : null,
					state.comboOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ComboManager, {
						copy: t,
						remote,
						sessionId,
						onClose: () => dispatch({
							type: "COMBO_OPEN",
							open: false
						}),
						onToast: (kind, text) => toast(kind, text),
						onChanged: () => {
							remote.call(EP_TOOL_COMBOS).then((items) => dispatch({
								type: "COMBOS_LOADED",
								items: Array.isArray(items) ? items : []
							})).catch(() => {});
						}
					}) : null,
					state.schedulerOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SchedulerManager, {
						copy: t,
						remote,
						sessionId,
						onClose: () => dispatch({
							type: "SCHEDULER_OPEN",
							open: false
						}),
						onToast: (kind, text) => toast(kind, text)
					}) : null,
					dragPreview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-drag-preview",
						style: {
							left: dragPreview.x + 12,
							top: dragPreview.y + 14
						},
						children: dragPreview.label
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-toast-host",
						children: state.toasts.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `wf-toast is-${item.kind}`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "wf-toast__dot" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.text })]
						}, item.id))
					})
				]
			});
		}
		//#endregion
		//#region src/client/studio/Studio.tsx
		function Studio({ t, sessionId, remote: remoteProp, onClose, onTitlebarDrag, viewMode, onToggleView, onEnterSplit }) {
			const remote = remoteProp ?? useRemote();
			const { state, dispatch } = useStudioState(sessionId);
			const { toast, toastError } = useToast(dispatch);
			const workflows = useWorkflows(dispatch, remote);
			const flowTemplates = useFlowTemplates(dispatch, remote);
			const templates = useTemplates(dispatch, remote);
			const selection = useSelection(dispatch);
			const history = useGraphHistory(state, dispatch);
			const guard = useUnsavedGuard(state, dispatch);
			const runControl = useRunControl(dispatch, remote);
			const serviceControl = useServiceControl(dispatch, remote);
			const modeSwitch = useModeSwitch(dispatch);
			const panels = usePanelLayout(state, dispatch);
			const currentFlow = currentFlowOf(state);
			useRunPolling(state.run.sessionId ?? currentFlow?.sessionId ?? state.sessionId, state.run.runId, dispatch, remote);
			useActiveRunsPolling(dispatch, remote);
			const canvasApiRef = (0, react.useRef)(null);
			const canvasShellRef = (0, react.useRef)(null);
			const libraryImportRef = (0, react.useRef)(null);
			const personaInputRef = (0, react.useRef)(null);
			const groupMdInputRef = (0, react.useRef)(null);
			const currentService = currentServiceOf(state);
			const currentFlowTemplate = currentFlowTemplateOf(state);
			const editorData = editorDataOf(state);
			const running = isRunningOf(state);
			const canvasCaption = currentFlowTemplate ? `模板：${currentFlowTemplate.name ?? ""}` : currentService ? `实例：${currentService.name ?? ""}` : currentFlow ? `实例：${currentFlow.name ?? ""}` : "";
			const highlightedNodeIds = (0, react.useMemo)(() => runningNodeIds(state.run.snapshot), [state.run.snapshot]);
			const runStatusByNode = (0, react.useMemo)(() => runStatusMap(state.run.snapshot), [state.run.snapshot]);
			(0, react.useEffect)(() => {
				if (state.mode !== "mode1") return;
				if (!currentFlow) return;
				const active = state.activeRuns.find((a) => a.flowId === currentFlow.id && a.sessionId === currentFlow.sessionId && a.status === "running");
				if (!active) return;
				if (state.run.runId === active.runId) return;
				dispatch({
					type: "RUN_STARTED",
					runId: active.runId,
					runSessionId: active.sessionId
				});
			}, [
				currentFlow,
				dispatch,
				state.activeRuns,
				state.mode,
				state.run.runId
			]);
			(0, react.useEffect)(() => {
				dispatch({
					type: "SET_SESSION",
					sessionId
				});
			}, [dispatch, sessionId]);
			(0, react.useEffect)(() => {
				if (typeof window === "undefined") return;
				keepInstanceOptions(window.localStorage, state.instanceOptions);
			}, [state.instanceOptions]);
			const notify = (0, react.useCallback)((kind, text) => {
				toast(kind, text);
			}, [toast]);
			useFlowFileSync(state, dispatch, remote, (0, react.useCallback)((message) => notify("error", message), [notify]));
			const modeName = (0, react.useCallback)((presetId) => {
				const value = String(presetId ?? "");
				if (!value) return "—";
				const names = t.modeNames;
				if (names[value]) return names[value];
				const preset = state.presets.find((item) => item.id === value);
				if (preset) return preset.name ?? value;
				const combo = state.combos.find((item) => item.id === value);
				if (combo) return combo.name;
				return value;
			}, [
				state.combos,
				state.presets,
				t.modeNames
			]);
			const doc = useDocumentActions(state, dispatch, guard, notify, toastError, workflows, flowTemplates, templates, selection, serviceControl, remote, t);
			const canvas = useCanvasActions(state, dispatch, notify, history, t);
			const editor = useEditorActions(state, dispatch, notify, toastError, t, workflows, flowTemplates, templates, selection, remote, doc.saveCanvas, canvas.removeSelected, canvas.removeLine, doc.selectWorkflow, doc.selectFlowTemplate);
			const run = useRunActions(state, dispatch, notify, toastError, t, remote, runControl, serviceControl, doc.saveCanvas, doc.createInstanceFromCanvas);
			const transfer = useStudioTransfer(state, dispatch, notify, toastError, t, remote, templates, flowTemplates, workflows, editor.patchEditor, editorData, personaInputRef, groupMdInputRef);
			const { beginLibraryDrag, dragPreview, dropGroupId } = useLibraryDrag(canvasShellRef, canvasApiRef);
			useKeyShortcuts(state, dispatch, selection, history, canvas.removeLine, canvas.removeSelected);
			useStudioBoot(state, dispatch, notify, toastError, t, remote, workflows, flowTemplates, templates, serviceControl, pickInitialInstanceForSession);
			const switchMode = (0, react.useCallback)((mode) => {
				if (mode === state.mode) return;
				guard.guard(() => {
					modeSwitch.setMode(mode);
					dispatch({ type: "CLEAR_CANVAS" });
					if (mode === "mode1") workflows.loadWorkflows();
					else serviceControl.loadServices();
				});
			}, [
				dispatch,
				guard,
				modeSwitch,
				serviceControl,
				state.mode,
				workflows
			]);
			const [modeMenuOpen, setModeMenuOpen] = (0, react.useState)(false);
			const requestClose = (0, react.useCallback)(() => {
				if (!onClose) return;
				guard.guard(() => onClose());
			}, [guard, onClose]);
			const handleRun = (0, react.useCallback)(() => {
				onEnterSplit?.();
				dispatch({
					type: "PANELS_SET",
					panels: { mode: 2 }
				});
				state.mode === "mode2" ? run.startService() : run.startRun();
			}, [
				dispatch,
				onEnterSplit,
				run,
				state.mode
			]);
			const panelsCollapsed = panelsFullyCollapsedOf(state);
			const togglePanels = (0, react.useCallback)(() => {
				dispatch({
					type: "PANELS_SET",
					panels: { mode: nextPanelMode(state.panels.mode) }
				});
			}, [dispatch, state.panels.mode]);
			(0, react.useEffect)(() => {
				if (viewMode === "split") dispatch({
					type: "PANELS_SET",
					panels: { mode: 2 }
				});
			}, []);
			const stageKinds = (0, react.useMemo)(() => stageTemplateKinds(state.mode), [state.mode]);
			const parentTemplate = (0, react.useMemo)(() => state.templates.role.find((item) => item.kind === "parent") ?? null, [state.templates.role]);
			const roleTemplates = (0, react.useMemo)(() => state.templates.role.filter((item) => item.kind !== "parent"), [state.templates.role]);
			const edgeList = (0, react.useMemo)(() => flowToCanvasLines(state.canvas.edges), [state.canvas.edges]);
			const toolbarRunning = state.mode === "mode2" ? currentService?.status === "running" : running;
			const leftOpen = leftPanelOpenOf(state);
			const bottomOpen = bottomPanelOpenOf(state);
			const inspectorOpen = inspectorOpenOf(state);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StudioLayout, {
				t,
				state,
				sessionId: state.sessionId,
				remote,
				onClose,
				onTitlebarDrag,
				currentFlow,
				currentService,
				currentFlowTemplate,
				editorData,
				edgeList,
				stageKinds,
				parentTemplate,
				roleTemplates,
				groupTemplates: state.templates.group,
				toolbarRunning,
				runStatusByNode,
				highlightedNodeIds,
				modeName,
				canvasCaption,
				leftOpen,
				bottomOpen,
				inspectorOpen,
				canvasApiRef,
				canvasShellRef,
				libraryImportRef,
				personaInputRef,
				groupMdInputRef,
				dispatch,
				doc,
				canvas,
				editor,
				run,
				transfer,
				selection,
				history,
				guard,
				panels,
				toast,
				beginLibraryDrag,
				dragPreview,
				dropGroupId,
				modeMenuOpen,
				setModeMenuOpen,
				switchMode,
				requestClose,
				viewMode,
				onToggleView,
				handleRun,
				panelsCollapsed,
				onTogglePanels: togglePanels
			});
		}
		//#endregion
		//#region src/client/studio/useWorkbenchView.ts
		/** 视图模式持久化键。 */
		const VIEW_MODE_KEY = "visual-workflow:view-mode";
		/** 分栏窗口宽度持久化键。 */
		const SPLIT_WIDTH_KEY = "visual-workflow:split-width";
		const SPLIT_WIDTH_MAX = 1280;
		/** 读取视图模式（损坏/未知回退 float）。 */
		function readViewMode(storage) {
			try {
				return storage.getItem("visual-workflow:view-mode") === "split" ? "split" : "float";
			} catch {
				return "float";
			}
		}
		/** 写入视图模式。 */
		function writeViewMode(storage, mode) {
			try {
				storage.setItem(VIEW_MODE_KEY, mode);
			} catch {}
		}
		/** 读取分栏宽度（钳制到合法区间）。 */
		function readSplitWidth(storage) {
			try {
				const value = Number(storage.getItem(SPLIT_WIDTH_KEY));
				if (!Number.isFinite(value) || value <= 0) return 640;
				return clampSplitWidth(value);
			} catch {
				return 640;
			}
		}
		/** 写入分栏宽度。 */
		function writeSplitWidth(storage, width) {
			try {
				storage.setItem(SPLIT_WIDTH_KEY, String(Math.round(clampSplitWidth(width))));
			} catch {}
		}
		/** 钳制分栏宽度到合法区间。 */
		function clampSplitWidth(width) {
			return Math.max(360, Math.min(SPLIT_WIDTH_MAX, Math.round(width)));
		}
		/** 官方对话主区域列（centerCol）：分栏时给它设右内边距让出右侧。 */
		function officialCenterCol() {
			return document.querySelector("[class*=\"centerCol\"]");
		}
		/** 官方侧边栏底部「设置」按钮（入口锚点：插到其上方 + 复制其样式）。 */
		function officialSettingButton() {
			return document.querySelector("[class*=\"settingsArea\"] button:not([data-wf-entry]), [class*=\"trigger\"]:not([data-wf-entry])");
		}
		/** 构建侧边栏入口按钮元素（图标 + 「工作流」）。
		*  样式与官方「设置」按钮一致：不复用其 className（CSS-module hash 类随构建/版本变化，
		*  且复制到的 hashed 类在部分状态下会引入浏览器默认外圈边框/发光层）。改为由 styles.ts 的
		*  button.wf-sidebar-entry 直接提取官方 trigger 样式逐字复刻，视觉与「设置」按钮完全一致，
		*  且不受 hash/主题状态影响。
		*  @param officialBtn 官方「设置」按钮，预留（当前不再读取其 className）；缺省仅 wf-sidebar-entry。 */
		function buildSidebarEntryButton(label, officialBtn) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "wf-sidebar-entry";
			button.dataset.wfEntry = "workflow";
			button.setAttribute("aria-label", label);
			const labelEl = document.createElement("div");
			labelEl.className = "wf-sidebar-entry__label";
			labelEl.textContent = label;
			button.append(labelEl);
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("width", "18");
			svg.setAttribute("height", "18");
			svg.setAttribute("aria-hidden", "true");
			const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
			p1.setAttribute("fill", "currentColor");
			p1.setAttribute("d", "M3 5h18v2H3zm0 6h18v2H3zm0 6h12v2H3z");
			svg.append(p1);
			button.prepend(svg);
			return button;
		}
		/**
		* 进入分栏：给官方对话主列 centerCol 设右内边距（左侧对话区），并把分栏宽度写入
		* :root CSS 变量（供 fixed 工作台使用）。**不修改官方 frame 网格结构**。
		* @param centerCol 官方对话主列。
		* @param width 分栏宽度（px）。
		*/
		function enterSplit(centerCol, width) {
			centerCol.style.paddingRight = width + "px";
			document.documentElement.style.setProperty("--wf-split-w", width + "px");
		}
		/** 退出分栏：还原官方对话主列右内边距与 :root CSS 变量。 */
		function exitSplit() {
			officialCenterCol()?.style.removeProperty("padding-right");
			document.documentElement.style.removeProperty("--wf-split-w");
		}
		/** 是否在浏览器环境（SSR/测试守卫）。 */
		function isBrowser() {
			return typeof document !== "undefined" && typeof window !== "undefined";
		}
		/** 工作台视图模式状态机。
		*  @param entryLabel 侧边栏入口按钮文案（随语言切换更新；由 WorkbenchHost 传入 t 词典
		*  对应键，如 t.workflows）。默认 '工作流'（保持既有行为）。 */
		function useWorkbenchView(entryLabel = "工作流") {
			const [open, setOpen] = (0, react.useState)(false);
			const [viewMode, setViewModeState] = (0, react.useState)(() => isBrowser() ? readViewMode(window.localStorage) : "float");
			const [splitWidth, setSplitWidthState] = (0, react.useState)(() => isBrowser() ? readSplitWidth(window.localStorage) : 640);
			const openRef = (0, react.useRef)(() => void 0);
			const entryRef = (0, react.useRef)(null);
			const entryLabelRef = (0, react.useRef)(entryLabel);
			const setViewMode = (0, react.useCallback)((mode) => {
				setViewModeState(mode);
				if (isBrowser()) writeViewMode(window.localStorage, mode);
			}, []);
			const openWorkbench = (0, react.useCallback)(() => {
				setOpen(true);
				if (isBrowser()) setViewModeState(readViewMode(window.localStorage));
			}, []);
			const closeWorkbench = (0, react.useCallback)(() => {
				setOpen(false);
			}, []);
			const toggleOpen = (0, react.useCallback)(() => {
				if (open) {
					setOpen(false);
					return;
				}
				setOpen(true);
				if (isBrowser()) setViewModeState(readViewMode(window.localStorage));
			}, [open]);
			const toggleView = (0, react.useCallback)(() => {
				setViewMode(viewMode === "float" ? "split" : "float");
			}, [setViewMode, viewMode]);
			const setSplitWidth = (0, react.useCallback)((width) => {
				const clamped = clampSplitWidth(width);
				setSplitWidthState(clamped);
				if (isBrowser()) {
					writeSplitWidth(window.localStorage, clamped);
					const centerCol = officialCenterCol();
					if (centerCol) centerCol.style.paddingRight = clamped + "px";
					document.documentElement.style.setProperty("--wf-split-w", clamped + "px");
				}
			}, []);
			(0, react.useEffect)(() => {
				openRef.current = toggleOpen;
			}, [toggleOpen]);
			(0, react.useEffect)(() => {
				if (!isBrowser()) return;
				let entry = null;
				const place = () => {
					const anchor = officialSettingButton();
					if (!anchor) return;
					const settingsArea = anchor.closest?.("[class*=\"settingsArea\"]") ?? anchor.parentElement;
					const footArea = settingsArea?.parentElement;
					if (!settingsArea || !footArea) return;
					if (!entry) {
						entry = buildSidebarEntryButton(entryLabelRef.current, anchor);
						entry.onclick = () => openRef.current();
						entryRef.current = entry;
					}
					const nextCls = "wf-sidebar-entry";
					if (entry.className !== nextCls) entry.className = nextCls;
					const collapsed = !!document.querySelector("[class*=\"sidebarCol\"] [class*=\"collapsed\"]");
					if (entry.classList.contains("wf-sidebar-entry--rail") !== collapsed) entry.classList.toggle("wf-sidebar-entry--rail", collapsed);
					if (entry.nextElementSibling !== settingsArea) footArea.insertBefore(entry, settingsArea);
				};
				place();
				const observer = new MutationObserver(() => place());
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
					entry?.remove();
					entry = null;
				};
			}, []);
			(0, react.useEffect)(() => {
				entryLabelRef.current = entryLabel;
				const btn = entryRef.current;
				if (!btn) return;
				const labelEl = btn.querySelector(".wf-sidebar-entry__label");
				if (labelEl && labelEl.textContent !== entryLabel) labelEl.textContent = entryLabel;
				if (btn.getAttribute("aria-label") !== entryLabel) btn.setAttribute("aria-label", entryLabel);
			}, [entryLabel]);
			(0, react.useEffect)(() => {
				if (!isBrowser()) return;
				if (open && viewMode === "split") {
					const centerCol = officialCenterCol();
					if (centerCol) enterSplit(centerCol, splitWidth);
					return;
				}
				exitSplit();
			}, [open, viewMode]);
			return {
				open,
				viewMode,
				splitWidth,
				openWorkbench,
				closeWorkbench,
				toggleOpen,
				setViewMode,
				toggleView,
				setSplitWidth
			};
		}
		//#endregion
		//#region src/client/studio/WorkbenchFrame.tsx
		/** 八向缩放把手方向（仅浮窗模式渲染）。 */
		const RESIZE_DIRECTIONS = [
			"n",
			"s",
			"e",
			"w",
			"ne",
			"nw",
			"se",
			"sw"
		];
		/**
		* 工作台统一窗口框架：children（Studio）恒挂载于框架内，视图模式切换与
		* 关闭（hidden）都不重建。浮窗几何（bounds）本地管理并持久化；切换分栏
		* 再切回时几何原样恢复。
		*/
		function WorkbenchFrame({ mode, onClose, splitWidth, onResize, hidden = false, children }) {
			const isFloat = mode === "float";
			const [bounds, setBounds] = (0, react.useState)(() => restoreBounds());
			const shellRef = (0, react.useRef)(null);
			/** 几何 CSSProperties：固定引用（React 重渲染跳过该 style diff，不覆盖直写值）。 */
			const styleRef = (0, react.useRef)({});
			/** 活动会话（唯一；常驻监听器读取；仅浮窗拖拽/缩放使用）。 */
			const sessionRef = (0, react.useRef)(null);
			/** 会话期间的 body 样式快照（常驻监听器在会话结束时恢复）。 */
			const bodyRestoreRef = (0, react.useRef)(null);
			/** 最近一次浮窗几何（split 期间不展示但保留，切回 float 时按记忆还原）。 */
			const boundsRef = (0, react.useRef)(bounds);
			styleRef.current = {
				left: `${bounds.x}px`,
				top: `${bounds.y}px`,
				width: `${bounds.w}px`,
				height: `${bounds.h}px`
			};
			/**
			* 同步几何（唯一写路径）：
			*  - el.style 直接写（DOM 层，React 不感知，move 期间零重渲染）；
			*  - styleRef 整体替换为新对象（绝不修改 React 已看过的对象——React dev 会冻结它）。
			*/
			const applyGeometry = (0, react.useCallback)((next) => {
				const el = shellRef.current;
				if (el) {
					el.style.left = `${next.x}px`;
					el.style.top = `${next.y}px`;
					el.style.width = `${next.w}px`;
					el.style.height = `${next.h}px`;
				}
				styleRef.current = {
					left: `${next.x}px`,
					top: `${next.y}px`,
					width: `${next.w}px`,
					height: `${next.h}px`
				};
			}, []);
			/** 提交几何（状态 + DOM + 持久化）。 */
			const commitBounds = (0, react.useCallback)((next) => {
				const clamped = clampBounds(next);
				boundsRef.current = clamped;
				applyGeometry(clamped);
				setBounds(clamped);
				keepBounds(clamped);
			}, [applyGeometry]);
			(0, react.useEffect)(() => {
				const onPointerMove = (event) => {
					const session = sessionRef.current;
					if (!session || event.pointerId !== session.pointerId) return;
					const dx = event.clientX - session.lastX;
					const dy = event.clientY - session.lastY;
					session.lastX = event.clientX;
					session.lastY = event.clientY;
					if (dx === 0 && dy === 0) return;
					const base = session.bounds;
					let next;
					if (session.kind === "drag") next = {
						...base,
						x: base.x + dx,
						y: base.y + dy
					};
					else {
						let { x, y, w, h } = base;
						const direction = session.direction ?? "se";
						if (direction.includes("e")) w = Math.max(480, w + dx);
						if (direction.includes("s")) h = Math.max(320, h + dy);
						if (direction.includes("w")) {
							w = Math.max(480, w - dx);
							x = base.x + (base.w - w);
						}
						if (direction.includes("n")) {
							h = Math.max(320, h - dy);
							y = base.y + (base.h - h);
						}
						next = {
							x,
							y,
							w,
							h
						};
					}
					const clamped = clampBounds(next);
					session.bounds = clamped;
					applyGeometry(clamped);
				};
				const endSession = (event) => {
					const session = sessionRef.current;
					if (!session || event.pointerId !== session.pointerId) return;
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
					commitBounds(session.bounds);
				};
				const onBlur = () => {
					const session = sessionRef.current;
					if (!session) return;
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
					commitBounds(session.bounds);
				};
				window.addEventListener("pointermove", onPointerMove);
				window.addEventListener("pointerup", endSession);
				window.addEventListener("pointercancel", endSession);
				window.addEventListener("blur", onBlur);
				return () => {
					window.removeEventListener("pointermove", onPointerMove);
					window.removeEventListener("pointerup", endSession);
					window.removeEventListener("pointercancel", endSession);
					window.removeEventListener("blur", onBlur);
					sessionRef.current = null;
					const restore = bodyRestoreRef.current;
					if (restore) {
						document.body.style.cursor = restore.cursor;
						document.body.style.userSelect = restore.userSelect;
						bodyRestoreRef.current = null;
					}
				};
			}, [applyGeometry, commitBounds]);
			/** 标题栏拖动开始（登记会话 + Pointer Capture；按钮/输入目标忽略）。 */
			const beginDrag = (0, react.useCallback)((event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				if (isInteractive(event.target ?? null)) return;
				event.preventDefault?.();
				const pointerId = Number(event.pointerId) || 0;
				const target = event.currentTarget;
				try {
					target?.setPointerCapture?.(pointerId);
				} catch {}
				bodyRestoreRef.current = {
					cursor: document.body.style.cursor,
					userSelect: document.body.style.userSelect
				};
				document.body.style.cursor = "move";
				document.body.style.userSelect = "none";
				sessionRef.current = {
					kind: "drag",
					pointerId,
					lastX: event.clientX,
					lastY: event.clientY,
					bounds: boundsRef.current
				};
			}, []);
			/** 八方向缩放开始（同上）。 */
			const beginResize = (0, react.useCallback)((direction, event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				event.preventDefault?.();
				const pointerId = Number(event.pointerId) || 0;
				const target = event.currentTarget;
				try {
					target?.setPointerCapture?.(pointerId);
				} catch {}
				bodyRestoreRef.current = {
					cursor: document.body.style.cursor,
					userSelect: document.body.style.userSelect
				};
				document.body.style.cursor = "se-resize";
				document.body.style.userSelect = "none";
				sessionRef.current = {
					kind: "resize",
					pointerId,
					lastX: event.clientX,
					lastY: event.clientY,
					bounds: boundsRef.current,
					direction
				};
			}, []);
			/** 分栏分隔线拖动开始（split 模式；常驻 window 监听；结束恢复）。 */
			const beginDividerDrag = (0, react.useCallback)((event) => {
				if (event.button !== void 0 && event.button !== 0) return;
				event.preventDefault?.();
				const pointerId = Number(event.pointerId) || 0;
				const target = event.currentTarget;
				try {
					target?.setPointerCapture?.(pointerId);
				} catch {}
				const right = window.innerWidth;
				const onMove = (moveEvent) => {
					onResize(clampSplitWidth(right - moveEvent.clientX));
				};
				const onUp = () => {
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					window.removeEventListener("pointercancel", onUp);
					window.removeEventListener("blur", onUp);
					document.body.style.cursor = "";
					document.body.style.userSelect = "";
				};
				document.body.style.cursor = "col-resize";
				document.body.style.userSelect = "none";
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
				window.addEventListener("pointercancel", onUp);
				window.addEventListener("blur", onUp);
			}, [onResize]);
			(0, react.useEffect)(() => {
				if (!isFloat) return;
				commitBounds(bounds);
			}, [isFloat]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: shellRef,
				className: isFloat ? "wf-window" : "wf-split-pane",
				style: isFloat ? hidden ? {
					...styleRef.current,
					display: "none"
				} : styleRef.current : hidden ? { display: "none" } : void 0,
				"data-wf-frame": mode,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-frame-content",
						children: children({
							close: onClose,
							drag: beginDrag
						})
					}),
					isFloat ? RESIZE_DIRECTIONS.map((direction) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `wf-window__resize is-${direction}`,
						"data-direction": direction,
						onPointerDown: (event) => beginResize(direction, event)
					}, direction)) : null,
					isFloat ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wf-split-divider",
						role: "separator",
						"aria-orientation": "vertical",
						title: "拖动调节分栏宽度",
						style: {
							position: "absolute",
							left: 0,
							top: 0,
							bottom: 0,
							width: 9,
							zIndex: 12,
							cursor: "col-resize",
							touchAction: "none"
						},
						onPointerDown: beginDividerDrag
					})
				]
			});
		}
		//#endregion
		//#region src/client/studio/WorkbenchHost.tsx
		/** 会话 id 解析：经 sessions 服务读当前选中会话（守卫；无会话返回空串）。 */
		function currentSessionOf(ctx) {
			const sessions = ctx.get?.("sessions");
			const current = (sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.())?.current;
			return typeof current === "string" ? current : "";
		}
		/** 会话树根 id 解析（实例/服务按会话树根隔离）。 */
		function rootSessionIdOf$1(current, sessions) {
			if (!current) return "";
			const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.();
			if (!snapshot?.byId) return current;
			let cursor = current;
			const seen = /* @__PURE__ */ new Set();
			while (cursor && !seen.has(cursor)) {
				seen.add(cursor);
				const entry = snapshot.byId[cursor];
				const parent = typeof entry?.parentSessionId === "string" ? entry.parentSessionId : "";
				if (!parent || !snapshot.byId[parent]) return cursor;
				cursor = parent;
			}
			return cursor;
		}
		/** 工作台宿主组件。 */
		function WorkbenchHost({ ctx, t }) {
			const view = useWorkbenchView(t.workflows);
			const [sessionId, setSessionId] = (0, react.useState)(() => rootSessionIdOf$1(currentSessionOf(ctx), ctx.get?.("sessions")));
			/** 是否打开过工作台（首次打开后才挂载框架：未打开页面零工作台开销；
			*  打开过后常驻挂载，此后关闭仅 hidden 隐藏不卸载——状态全保留）。 */
			const [everOpened, setEverOpened] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (view.open) setEverOpened(true);
			}, [view.open]);
			(0, react.useEffect)(() => {
				const off = (ctx.get?.("sessions"))?.list?.subscribe?.(() => {
					setSessionId(rootSessionIdOf$1(currentSessionOf(ctx), ctx.get?.("sessions")));
				});
				return () => {
					off?.();
				};
			}, [ctx]);
			const studioProps = {
				t,
				sessionId,
				viewMode: view.viewMode,
				onToggleView: view.toggleView,
				onEnterSplit: () => view.setViewMode("split")
			};
			if (!everOpened) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkbenchFrame, {
				mode: view.viewMode,
				splitWidth: view.splitWidth,
				onResize: view.setSplitWidth,
				onClose: view.closeWorkbench,
				hidden: !view.open,
				children: (frameApi) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Studio, {
					...studioProps,
					onClose: view.viewMode === "float" ? frameApi.close : void 0,
					onTitlebarDrag: view.viewMode === "float" ? frameApi.drag : void 0
				})
			});
		}
		//#endregion
		//#region src/client/i18n.ts
		const zh = {
			studio: "工作流设计器",
			badge: "可视化编排",
			note: "拖拽卡片 · 连线编排 · 一键运行",
			windowTitle: "工作流设计器",
			windowClose: "关闭",
			toggleWindow: "切换窗口",
			viewFloat: "悬浮窗口",
			viewSplit: "分栏窗口",
			fabOpen: "打开工作流工作台",
			currentSession: "当前会话",
			currentSessionUnavailable: "当前会话不可用：请先在对话区发送一条消息激活会话，再打开工作台",
			mode1: "流程编排",
			mode2: "API服务",
			modeLabel1: "模式一",
			modeLabel2: "模式二",
			workflows: "工作流",
			services: "服务",
			libTab: {
				workflow: "工作流",
				role: "角色",
				data: "数据",
				other: "其他"
			},
			flowInstances: "实例",
			flowTemplates: "工作流模板",
			instanceRunning: "运行中",
			parentAgent: "父代理",
			parentAgentHint: "调度中枢（置顶）",
			roleTemplates: "角色模板",
			files: "文件",
			databases: "数据库",
			stages: "阶段",
			groupTemplates: "协作组",
			groupHint: "组内角色并行执行",
			groupMemberLimitHint: "协作组成员数量上限为 8",
			toastGroupMemberAdded: "已加入协作组",
			stagePinHint: "固定模板",
			newTemplate: "新建模板",
			libEmptyTemplates: "暂无模板，点击右侧 + 新建",
			libEmptyInstances: "暂无实例：从下方模板拖入画布后点击「创建实例」",
			nodes: "节点",
			undo: "撤销",
			redo: "重做",
			clear: "清空",
			clearCanvas: "清空画布",
			clearCanvasHint: "确定清空画布中所有节点？（可通过撤销恢复）",
			tidy: "整理布局",
			togglePanels: "切换左栏/底栏",
			save: "保存",
			createInstance: "创建实例",
			saveInstance: "保存实例",
			createService: "创建服务",
			saveServiceInstance: "保存服务",
			run: "运行",
			stop: "停止",
			startService: "启动服务",
			stopService: "停止服务",
			restartService: "重启服务",
			serviceRunning: "运行中",
			serviceStarting: "启动中…",
			serviceStopped: "已停止",
			serviceCrashed: "已崩溃",
			serviceConsole: "服务控制台",
			serviceHint: "服务进程与主进程隔离，关闭页面不释放",
			serviceDebugTitle: "调试输入",
			serviceDebugPlaceholder: "向运行中的服务发送问题，流式回复在此实时显示",
			serviceDebugSend: "发送调试",
			serviceDebugStop: "停止",
			serviceDebugEmpty: "服务运行中，发送问题后 SSE 流式回答将实时显示在此处",
			serviceDebugHint: "调试请求经独立调试会话发送，与真实用户会话隔离",
			history: "运行历史",
			toolbarHint: "画布改动请点击保存",
			saveAsTemplate: "另存为模板",
			toastSavedAsTemplate: "已另存为模板",
			toastCreatedInstance: "已创建实例",
			toastExternalModified: "实例文件已被外部修改",
			flowFileChanged: "实例文件已被外部修改，点击「刷新」加载最新内容",
			refresh: "刷新",
			emptyHint: "从左侧拖入卡片开始编排",
			fitView: "全图",
			zoomIn: "放大",
			zoomOut: "缩小",
			nodeKinds: {
				parent: "父代理",
				agent: "子代理",
				file: "文件",
				database: "数据库",
				start: "启动",
				end: "结束",
				pause: "暂停",
				group: "协作组",
				proxy: "虚拟节点"
			},
			fileKindLabel: {
				text: "文本",
				file: "文件"
			},
			dbLocalLabel: "本地库",
			dbBm25Badge: "相似度检索（非语义）",
			proxyBadge: "↻ 引用",
			inspectorEmpty: "从左侧选择卡片或点击画布节点进行编辑",
			inspectorSave: "保存",
			inspectorDelete: "删除",
			inspectorCopy: "复制",
			label: "名称",
			persona: "System Prompt",
			personaHint: "描述该角色的身份、职责与任务目标（也可从 .md 文件加载）",
			injectSystemPromptLabel: "系统提示词开关",
			injectSystemPromptInjected: "当前已注入",
			injectSystemPromptNotInjected: "未注入",
			injectSystemPromptOn: "注入官方系统提示词",
			injectSystemPromptOff: "关闭（移除官方系统提示词）",
			injectSystemPromptHint: "开（默认）：官方系统提示词正常注入；关：移除官方系统提示词与上下文段，保留角色段与工具相关段（含 Code Mode 协议段）",
			injectToolSectionsLabel: "工具提示词开关",
			injectToolSectionsInjected: "当前已注入",
			injectToolSectionsNotInjected: "未注入",
			injectToolSectionsOn: "注入工具提示词（tool:* 段）",
			injectToolSectionsOff: "关闭（移除工具提示词散文段）",
			injectToolSectionsHint: "开（默认）：注入各工具的使用指引（tool:* 段）；关：移除工具提示词散文段，仍保留工具 Schema（模型仍能看到工具清单）与 Code Mode 协议段",
			promptFilePath: "Prompt 文件路径",
			promptFilePathPlaceholder: "如 D:\\work\\agent.md（可空，直接使用上方文本）",
			promptFilePathHint: "设置文件路径：Prompt自动热重载",
			loadMd: "从 .md 文件加载",
			loadMdTitle: "选择一个 Markdown 文件作为角色与任务内容",
			provider: "服务商",
			model: "模型",
			modeLabel: "模式",
			thinking: "思考强度",
			thinkingHint: "off/low/high/max",
			thinkingUnsupportedHint: "该模型不支持思考强度（保持默认）",
			modeNames: {
				standard: "标准",
				minimal: "极简",
				ptc: "ptc"
			},
			modeSummary: "已选 {count} 项",
			advanced: "高级选项",
			retryLimit: "回流重试上限",
			reactLimit: "ReAct 迭代上限",
			reactLimitHint: "0 = 不设限",
			parentAdvancedHint: "父代理高级选项仅含 ReAct 迭代上限与回流重试上限",
			inputSchema: "输入结构",
			outputSchema: "输出结构",
			fileKind: "文件类型",
			fileContent: "文件内容",
			selectedFile: "已选文件",
			fileUnset: "未选择文件",
			/** 文件多选提示（已选文件列表显示在按钮下方，用户验收标注）。 */
			filePickHint: "可多选所有类型文件；非文本文件复制到插件受管目录",
			/** 协作组拖拽悬停提示（用户验收标注：放开以入组）。 */
			groupDropHint: "放开以入组",
			/** 角色卡元信息「模型」前缀。 */
			nodeMetaModel: "模型",
			/** 画布节点元信息「组合」前缀（显示选择的模式或组合，用户验收标注）。 */
			nodeMetaPreset: "组合",
			description: "描述",
			descriptionHint: "数据库用途说明",
			dbTypeLabel: "类型",
			dbTypeLocal: "本地",
			dbTypeServer: "服务器",
			dbKindLabel: "数据库引擎",
			dbHost: "地址",
			dbPort: "端口",
			dbUser: "用户名",
			dbPassword: "密码",
			dbName: "库名",
			dbTest: "测试连接",
			dbTestSuccess: "数据库连接成功",
			dbLocalPath: "本地数据库文件路径",
			dbVectorSource: "检索方式",
			dbVectorEmbedding: "语义向量检索",
			dbVectorBm25: "BM25 相似度",
			dbLocalHint: "本地库提供内置向量检索（bge-small-zh-v1.5）；资产缺失时自动降级 BM25",
			dbAdvanced: "高级选项",
			dbTopK: "召回条数",
			dbChunkSize: "分块窗口(字符)",
			dbOverlap: "分块重叠(字符)",
			dbScoreThreshold: "相似度阈值",
			dbMaxRows: "索引容量(行)",
			dbAdvancedHint: "召回条数=每次返回命中数(默认5,上限50)\n分块窗口/重叠=索引分块大小(384/128)\n相似度阈值=仅保留更高分(默认0)\n索引容量=单库最多索引行数(默认10000)",
			stageReadonlyHint: "阶段节点属性固定（名称硬编码），不支持编辑；删除按钮仅移除画布节点",
			collabPrompt: "协作 Prompt",
			collabPromptHint: "追加注入到组内成员的用户消息；无论此处文本是否为空都默认列出组内全部成员（告知协作对象与可发消息对象）",
			groupMembers: "组合成员",
			groupMemberHint: "把角色拖入组内（或删除成员以移出）",
			groupDefaultName: "协作组",
			/** 卡片右上角「交换左右连接点」按钮提示（用户批注：美化布线防交叉）。 */
			swapPorts: "交换左右连接点",
			proxyMainLabel: "主节点",
			proxyReadonlyHint: "虚拟节点不存储独立配置，与主节点共享执行实例；修改主节点实时同步",
			parentTemplateHint: "父代理模板无独立属性（画布中的父代理节点可编辑）",
			line: "连线",
			lineType: "连线类型",
			lineTypeFlow: "流程",
			lineTypePass: "通过",
			lineTypeFail: "不通过",
			lineTypeContent: "内容",
			lineContentValue: "内容值",
			lineContentHint: "如：路由 / 审批",
			lineConditionHint: "条件连线仅流程出→流程入；「内容」类型由父代理按标签语义判断",
			workflow: "工作流",
			service: "服务",
			flowName: "名称",
			flowDescription: "描述",
			meta: "状态",
			newWorkflow: "新建工作流",
			deleteFlow: "删除工作流",
			templateDefaultName: {
				workflow: "未命名工作流",
				role: "新角色模板",
				file: "新文件模板",
				database: "新数据库模板",
				group: "新协作组模板"
			},
			deleteTemplateTitle: "删除模板",
			deleteTemplateMessage: "确定删除模板「{name}」？",
			confirmDelete: "确定删除？",
			unsavedTitle: "当前画布有未保存的修改",
			unsavedMessage: "在继续之前，请选择如何处理当前画布的修改。",
			unsavedSave: "保存修改",
			unsavedDiscard: "放弃修改",
			unsavedCancel: "取消",
			importWorkflow: "导入",
			exportWorkflow: "导出",
			exportFileName: "visual-workflow",
			exportEmpty: "当前没有可导出的内容（请先选择工作流或角色模板）",
			importConflictTitle: "导入冲突",
			importConflictMessage: "已存在同名「{name}」。请选择处理方式。",
			importOverwrite: "覆盖",
			importRename: "改名导入",
			importCancel: "取消",
			toastImported: "导入成功",
			toastExported: "已导出",
			needStartAndEnd: "请先添加启动和结束节点",
			needParentForService: "模式二必须存在父代理节点",
			toastRunning: "运行已开始",
			toastStopped: "运行已停止",
			toastSaved: "已保存",
			toastDeleted: "已删除",
			toastNodeAdded: "已添加节点",
			toastTidy: "已整理布局",
			toastCleared: "已清空",
			toastProxyCreated: "已创建虚拟节点",
			toastServiceStarted: "服务已启动",
			toastServiceStopped: "服务已停止",
			toastResuming: "已从断点恢复运行",
			parentDuplicatedHint: "每个工作流画布最多一个父代理节点",
			stageDuplicatedHint: "启动/结束节点在画布中只能分别存在一个",
			deleteNode: "删除节点",
			proxyCascadeHint: "该节点存在 {count} 个虚拟引用，删除后将级联清除",
			invalidConnection: "连接不合法",
			selfLoop: "不允许自环",
			duplicateConnection: "重复连线",
			proxyParallel: "主节点与虚拟节点不得同时连入同一连接点",
			groupMemberFlowLine: "协作组成员不能连流程线，仅可连上下文/数据库线",
			status: {
				pending: "等待",
				running: "运行中",
				armed: "待命",
				ok: "完成",
				fail: "失败",
				skipped: "跳过",
				"react-capped": "软截停",
				stopped: "已停止",
				completed: "完成",
				failed: "失败",
				paused: "已暂停",
				interrupted: "已中断"
			},
			historyEmpty: "还没有运行记录",
			resumedFrom: "续跑自",
			resumeFromNode: "断点节点",
			resumeRun: "恢复运行",
			newSession: "开启新会话",
			newSessionHint: "勾选后从模板「创建实例」时先新建独立主会话，实例绑定该新会话；之后运行只认实例绑定的会话（一次性动作，不随模板/实例保存）",
			workspacePlaceholder: "如 D:\\work\\project（新会话工作区，须为存在的目录；留空则继承当前会话工作区）",
			workspaceHint: "新会话工作区路径（绝对路径目录）；该路径即新会话 cwd，也是沙箱 workspace-write 根，创建实例时校验存在，留空默认继承当前会话工作区",
			currentSessionBadge: "当前",
			overwriteInstanceTitle: "覆盖已有实例",
			overwriteInstanceMessage: "该会话已绑定一个工作流实例，新运行的工作流将会覆盖旧的工作流（旧实例内容将更新为新模板内容，运行历史保留）。是否继续？",
			overwriteInstanceConfirm: "覆盖",
			toastInstanceOverwritten: "已覆盖实例",
			toastServiceRunningCannotOverwrite: "该会话的服务实例正在运行，请先停止服务后再覆盖",
			sessionLabelWorkflowPrefix: "工作流实例：",
			combos: "组合",
			comboManager: "组合管理",
			comboTabDsh: "工具",
			comboTabTool: "项",
			comboTabMcp: "MCP 服务器",
			comboSearch: "搜索工具名称或描述…",
			comboSearchEmpty: "没有匹配的工具（支持按名称或中文描述搜索）",
			comboNew: "新建组合",
			comboName: "组合名称",
			comboDelete: "删除组合",
			comboHint: "勾选工具与 MCP 服务器组成模式配置",
			comboEmptySelection: "还没有勾选任何工具或 MCP",
			comboEmpty: "还没有组合，点击「新建组合」开始",
			comboSaved: "组合已保存",
			comboDeleted: "组合已删除",
			comboSaveFirst: "请先为组合命名",
			comboTagDisableAll: "一键关闭",
			comboTagEnableAll: "一键开启",
			comboTagBulkHint: "一键开关当前标签下全部工具（不影响官方工具或其他标签）",
			toolSwitchBatchEnabled: "已开启当前标签下全部工具",
			toolSwitchBatchDisabled: "已关闭当前标签下全部工具",
			loadedPluginsLabel: "已装载 {count} 个插件（其工具已在上方逐个列出，可单独勾选）",
			mcpNew: "新建 MCP 服务器",
			mcpEdit: "编辑",
			mcpName: "服务器名称",
			mcpTransport: "连接方式",
			mcpTransportStdio: "stdio（本地命令）",
			mcpTransportHttp: "streamable-http（远程 URL）",
			mcpCommand: "启动命令（整行直接粘贴）",
			mcpArgs: "附加参数（已合并进启动命令）",
			mcpEnv: "环境变量（JSON，可选）",
			mcpHeaders: "请求头（JSON，可选）",
			mcpCommandHint: "通用填写规范：① 本地脚本：node <脚本路径> [flags]　② npx 一行：npx -y <包名> [flags]（Windows 自动经 cmd 启动）　③ 远程服务：连接方式选 streamable-http + 填 URL。含空格的路径请用引号。",
			mcpImport: "从 mcp.json 导入",
			mcpImportApply: "导入",
			mcpImportHint: "粘贴标准 mcp.json 的 server 对象或 {mcpServers:{name:{...}}}，导入后请核对再保存。",
			mcpImported: "已导入，请核对后保存",
			mcpUrl: "URL",
			mcpSave: "保存服务器",
			mcpDelete: "删除",
			mcpEnable: "启用",
			mcpDisable: "停用",
			mcpEnabled: "MCP 服务器已启用（重启 dsh web 后生效）",
			mcpDisabled: "MCP 服务器已停用（重启 dsh web 后生效）",
			mcpSaved: "MCP 服务器已保存（重启 dsh web 后生效）",
			mcpDeleted: "MCP 服务器已删除（重启 dsh web 后生效）",
			mcpRestartHint: "MCP 增删改写入 profile 配置，重启 dsh web 后生效",
			presetCustom: "自定义清单",
			comboDeleteConfirm: "确认删除",
			toolEnable: "开启",
			toolDisable: "关闭",
			toolSwitchEnabled: "工具已开启：所有会话的父代理均可见",
			toolSwitchDisabled: "工具已关闭：所有会话的父代理与子代理均不再可见",
			scheduler: "定时任务",
			schedulerManager: "定时任务管理",
			schedulerHint: "按执行窗口与触发策略自动运行所选工作流（触发 = 自动创建实例并运行）",
			schedulerNew: "新建任务",
			schedulerName: "任务名称",
			schedulerTemplate: "执行工作流",
			schedulerTemplatePlaceholder: "选择要执行的模式一工作流模板…",
			schedulerTemplateEmpty: "暂无可用工作流模板（先在工作台「另存为模板」创建）",
			schedulerSessionMode: "运行会话",
			schedulerSessionNew: "新会话（每轮自动创建会话并运行）",
			schedulerSessionCurrent: "当前会话（每轮复用本会话，不新建）",
			schedulerSessionNewHint: "每轮触发创建新会话（任务执行不依赖手动激活的会话）；若流程被暂停未完成，续跑仍在当前会话内进行",
			schedulerSessionCurrentHint: "每轮触发复用创建本任务时所在会话；会话未激活时触发将失败并跳过本轮",
			schedulerTimezone: "时区",
			schedulerWindow: "执行窗口（第一层）",
			schedulerWindowHint: "错峰 API 调用的限制：窗口有效是触发的前提；运行到窗口结束仍未完成时挂起，下一窗口继续",
			schedulerWindowDates: "有效日期范围",
			schedulerWindowDateStart: "开始日期",
			schedulerWindowDateEnd: "结束日期",
			schedulerWindowUnbounded: "日期不限",
			schedulerWindowDays: "有效星期",
			schedulerWindowDaysAll: "每天",
			schedulerWindowRanges: "可执行时间段",
			schedulerRangeStart: "开始时间",
			schedulerRangeEnd: "结束时间",
			schedulerRangeAdd: "添加时间段",
			schedulerRangeCrossHint: "结束不晚于开始时按跨天处理（如 22:00–06:00 覆盖次日凌晨）",
			schedulerTrigger: "触发策略（第二层）",
			schedulerTriggerDaily: "定点时刻",
			schedulerTriggerInterval: "固定间隔",
			schedulerTimePoints: "触发时刻",
			schedulerTimePointAdd: "添加时刻",
			schedulerInterval: "间隔（分钟）",
			schedulerIntervalStartFrom: "起始时刻",
			schedulerIntervalHint: "每个有效日从起始时刻起按间隔触发；跨过次日 00:00 的点自动废弃",
			schedulerPolicy: "运行时策略",
			schedulerPolicyText: "错过触发：不补打（skip） · 上轮未结束：跳过本轮（skip） · 配置修改：立即生效（immediate）",
			schedulerEnabled: "启用",
			schedulerNextRun: "下次触发",
			schedulerCurrentRun: "当前运行",
			schedulerLastOutcome: "最近结果",
			schedulerEmpty: "还没有定时任务，点击「新建任务」开始",
			schedulerStatus: {
				idle: "待触发",
				running: "运行中",
				waiting: "窗口暂停",
				paused: "已暂停",
				error: "触发失败"
			},
			schedulerLastResult: {
				started: "已触发运行",
				resumed: "窗口续跑",
				failed: "触发失败",
				skipped: "跳过（上轮未结束）"
			},
			schedulerDelete: "删除任务",
			schedulerDeleteConfirm: "确认删除",
			schedulerDeleteHint: "删除只影响未来触发，正在运行/暂停的流程不受干扰",
			schedulerSaved: "任务已保存",
			schedulerDeleted: "任务已删除",
			schedulerSaveFirst: "请先保存任务（新建后自动选中）",
			schedulerNeedName: "请填写任务名称",
			schedulerNeedTemplate: "请选择执行的工作流模板",
			schedulerDraftUnsaved: "有未保存的修改",
			schedulerError: "任务保存失败"
		};
		const en = {
			studio: "Workflow Designer",
			badge: "Visual Orchestration",
			note: "Drag cards · Wire connections · Run",
			windowTitle: "Workflow Designer",
			windowClose: "Close",
			toggleWindow: "Toggle window",
			viewFloat: "Floating window",
			viewSplit: "Split window",
			fabOpen: "Open workflow studio",
			currentSession: "Current session",
			currentSessionUnavailable: "Session unavailable: send a message in the chat first, then reopen the studio",
			mode1: "Orchestration Mode",
			mode2: "Service Mode",
			modeLabel1: "Mode 1",
			modeLabel2: "Mode 2",
			workflows: "Workflows",
			services: "Services",
			libTab: {
				workflow: "Workflows",
				role: "Agents",
				data: "Data",
				other: "Other"
			},
			flowInstances: "Instances",
			flowTemplates: "Workflow templates",
			instanceRunning: "Running",
			parentAgent: "Parent Agent",
			parentAgentHint: "Scheduler (pinned)",
			roleTemplates: "Agent templates",
			files: "Files",
			databases: "Databases",
			stages: "Stages",
			groupTemplates: "Groups",
			groupHint: "Members run in parallel",
			groupMemberLimitHint: "A group supports up to 8 members",
			toastGroupMemberAdded: "Added to group",
			stagePinHint: "Fixed template",
			newTemplate: "New template",
			libEmptyTemplates: "No templates yet — click + to create",
			libEmptyInstances: "No instances yet — drag a template into the canvas then click \"Create instance\"",
			nodes: "nodes",
			undo: "Undo",
			redo: "Redo",
			clear: "Clear",
			clearCanvas: "Clear canvas",
			clearCanvasHint: "Clear all nodes on the canvas? (undo supported)",
			tidy: "Tidy layout",
			togglePanels: "Switch left/bottom panel",
			save: "Save",
			createInstance: "Create instance",
			saveInstance: "Save instance",
			createService: "Create service",
			saveServiceInstance: "Save service",
			run: "Run",
			stop: "Stop",
			startService: "Start service",
			stopService: "Stop service",
			restartService: "Restart service",
			serviceRunning: "Running",
			serviceStarting: "Starting…",
			serviceStopped: "Stopped",
			serviceCrashed: "Crashed",
			serviceConsole: "Service console",
			serviceHint: "Service process is isolated from the host",
			serviceDebugTitle: "Debug input",
			serviceDebugPlaceholder: "Send a question to the running service; the streamed answer appears here",
			serviceDebugSend: "Send",
			serviceDebugStop: "Stop",
			serviceDebugEmpty: "Run the service, then send a question to preview the SSE streamed answer",
			serviceDebugHint: "Debug requests use a separate debug session, isolated from real users",
			history: "Run History",
			toolbarHint: "Save to persist canvas changes",
			saveAsTemplate: "Save as template",
			toastSavedAsTemplate: "Saved as template",
			toastCreatedInstance: "Instance created",
			toastExternalModified: "Instance file changed externally",
			flowFileChanged: "Instance file changed externally — click \"Refresh\" to load the latest content",
			refresh: "Refresh",
			emptyHint: "Drag cards from the left to start",
			fitView: "Fit view",
			zoomIn: "Zoom in",
			zoomOut: "Zoom out",
			nodeKinds: {
				parent: "Parent",
				agent: "Agent",
				file: "File",
				database: "Database",
				start: "Start",
				end: "End",
				pause: "Pause",
				group: "Group",
				proxy: "Proxy"
			},
			fileKindLabel: {
				text: "Text",
				file: "File"
			},
			dbLocalLabel: "Local DB",
			dbBm25Badge: "BM25 (non-semantic)",
			proxyBadge: "↻ ref",
			inspectorEmpty: "Select a card on the left or a node on the canvas",
			inspectorSave: "Save",
			inspectorDelete: "Delete",
			inspectorCopy: "Copy",
			label: "Label",
			persona: "Role & Task",
			personaHint: "Describe the agent role, duties and goals (or load from a .md file)",
			injectSystemPromptLabel: "System Prompt switch",
			injectSystemPromptInjected: "injected",
			injectSystemPromptNotInjected: "not injected",
			injectSystemPromptOn: "Inject official system prompt",
			injectSystemPromptOff: "Off (remove official system prompt)",
			injectSystemPromptHint: "On (default): official system prompt is injected normally; Off: remove official system prompt & runtime context, keeping role & tool-related sections (incl. Code Mode protocol)",
			injectToolSectionsLabel: "Tool prompt switch",
			injectToolSectionsInjected: "injected",
			injectToolSectionsNotInjected: "not injected",
			injectToolSectionsOn: "Inject tool guidance (tool:* sections)",
			injectToolSectionsOff: "Off (remove tool guidance prose)",
			injectToolSectionsHint: "On (default): inject per-tool guidance (tool:* sections); Off: remove tool guidance prose, keeping tool schemas (model still sees the tool list) & Code Mode protocol sections",
			promptFilePath: "Prompt file path",
			promptFilePathPlaceholder: "e.g. D:\\work\\agent.md (optional; use the text above instead)",
			promptFilePathHint: "Set file path: Prompt auto-reloads",
			loadMd: "Load from .md file",
			loadMdTitle: "Choose a Markdown file as the role & task content",
			provider: "Provider",
			model: "Model",
			modeLabel: "Mode",
			thinking: "Thinking effort",
			thinkingHint: "off/low/high/max",
			thinkingUnsupportedHint: "This model does not support thinking effort (keep default)",
			modeNames: {
				standard: "Standard",
				minimal: "Minimal",
				ptc: "ptc"
			},
			modeSummary: "{count} item(s) selected",
			advanced: "Advanced",
			retryLimit: "Retry limit",
			reactLimit: "ReAct limit",
			reactLimitHint: "0 = unlimited",
			parentAdvancedHint: "Parent advanced options: ReAct limit & retry limit only",
			inputSchema: "Input schema",
			outputSchema: "Output schema",
			fileKind: "File kind",
			fileContent: "File content",
			selectedFile: "selected file",
			fileUnset: "No file selected",
			filePickHint: "Select files of all types; non-text files are copied into the plugin-managed directory",
			groupDropHint: "Drop to join the group",
			nodeMetaModel: "Model",
			nodeMetaPreset: "Preset",
			description: "Description",
			descriptionHint: "Database purpose",
			dbTypeLabel: "Type",
			dbTypeLocal: "Local",
			dbTypeServer: "Server",
			dbKindLabel: "Engine",
			dbHost: "Host",
			dbPort: "Port",
			dbUser: "User",
			dbPassword: "Password",
			dbName: "Database",
			dbTest: "Test connection",
			dbTestSuccess: "Database connection OK",
			dbLocalPath: "Local database file path",
			dbVectorSource: "Retrieval mode",
			dbVectorEmbedding: "Semantic vectors",
			dbVectorBm25: "BM25 similarity",
			dbLocalHint: "Local DB provides built-in vector search (bge-small-zh-v1.5); falls back to BM25 when assets are missing",
			dbAdvanced: "Advanced options",
			dbTopK: "Top-K recall",
			dbChunkSize: "Chunk size (chars)",
			dbOverlap: "Chunk overlap (chars)",
			dbScoreThreshold: "Similarity threshold",
			dbMaxRows: "Index rows cap",
			dbAdvancedHint: "Top-K: hits per search (default 5, max 50)\nchunk size/overlap: index window (384/128)\nthreshold: keep only higher scores (default 0)\nindex rows cap: rows indexed per DB (default 10000)",
			stageReadonlyHint: "Stage node attributes are fixed (hardcoded label); delete removes the canvas node only",
			collabPrompt: "Collab prompt",
			collabPromptHint: "Appended to every member user message; always lists all group members (who you can message)",
			groupMembers: "Members",
			groupMemberHint: "Drag agents into the group (or remove members to exit)",
			groupDefaultName: "Group",
			swapPorts: "Swap left/right ports",
			proxyMainLabel: "Main node",
			proxyReadonlyHint: "Proxy nodes share the main node instance; edits on the main node sync automatically",
			parentTemplateHint: "The parent template has no standalone properties (canvas parent nodes are editable)",
			line: "Line",
			lineType: "Line type",
			lineTypeFlow: "Flow",
			lineTypePass: "Pass",
			lineTypeFail: "Fail",
			lineTypeContent: "Content",
			lineContentValue: "Content value",
			lineContentHint: "e.g. routing / approval",
			lineConditionHint: "Conditional lines only apply flow-out → flow-in; content type is judged semantically by the parent",
			workflow: "Workflow",
			service: "Service",
			flowName: "Name",
			flowDescription: "Description",
			meta: "Status",
			newWorkflow: "New workflow",
			deleteFlow: "Delete workflow",
			templateDefaultName: {
				workflow: "Untitled workflow",
				role: "New agent template",
				file: "New file template",
				database: "New database template",
				group: "New group template"
			},
			deleteTemplateTitle: "Delete template",
			deleteTemplateMessage: "Delete template \"{name}\"?",
			confirmDelete: "Delete?",
			unsavedTitle: "Unsaved canvas changes",
			unsavedMessage: "Choose how to handle the current canvas changes before continuing.",
			unsavedSave: "Save changes",
			unsavedDiscard: "Discard",
			unsavedCancel: "Cancel",
			importWorkflow: "Import",
			exportWorkflow: "Export",
			exportFileName: "visual-workflow",
			exportEmpty: "Nothing to export (select a workflow or agent template first)",
			importConflictTitle: "Import conflict",
			importConflictMessage: "\"{name}\" already exists. How should it be handled?",
			importOverwrite: "Overwrite",
			importRename: "Import as copy",
			importCancel: "Cancel",
			toastImported: "Imported",
			toastExported: "Exported",
			needStartAndEnd: "Add start and end nodes first",
			needParentForService: "Mode 2 requires a parent agent node",
			toastRunning: "Run started",
			toastStopped: "Run stopped",
			toastSaved: "Saved",
			toastDeleted: "Deleted",
			toastNodeAdded: "Node added",
			toastTidy: "Layout tidied",
			toastCleared: "Cleared",
			toastProxyCreated: "Proxy node created",
			toastServiceStarted: "Service started",
			toastServiceStopped: "Service stopped",
			toastResuming: "Resumed from checkpoint",
			parentDuplicatedHint: "At most one parent agent node per canvas",
			stageDuplicatedHint: "Only one start/end node allowed on the canvas",
			deleteNode: "Delete node",
			proxyCascadeHint: "{count} proxy reference(s) will be removed together",
			invalidConnection: "Invalid connection",
			selfLoop: "Self loops are not allowed",
			duplicateConnection: "Duplicate connection",
			proxyParallel: "Main node and its proxies cannot share the same target handle",
			groupMemberFlowLine: "Group members can only connect context/database lines, not flow lines",
			status: {
				pending: "Pending",
				running: "Running",
				armed: "Standby",
				ok: "Done",
				fail: "Failed",
				skipped: "Skipped",
				"react-capped": "Soft-capped",
				stopped: "Stopped",
				completed: "Done",
				failed: "Failed",
				paused: "Paused",
				interrupted: "Interrupted"
			},
			historyEmpty: "No run records yet",
			resumedFrom: "resumed from",
			resumeFromNode: "checkpoint",
			resumeRun: "Resume",
			newSession: "Start in new session",
			newSessionHint: "When on, creating an instance from a template first creates a fresh main session and binds the instance to it; subsequent runs only use the session the instance is bound to (one-shot option, never persisted to the template/instance)",
			workspacePlaceholder: "e.g. D:\\work\\project (new-session workspace; must exist; blank inherits the current session workspace)",
			workspaceHint: "Absolute workspace path for the new session (session cwd = sandbox workspace-write root); validated at instance creation; blank inherits the current session workspace",
			currentSessionBadge: "Current",
			overwriteInstanceTitle: "Overwrite existing instance",
			overwriteInstanceMessage: "This session already holds a workflow instance; the new workflow will overwrite the old one (the old instance content is replaced with the new template content, run history is kept). Continue?",
			overwriteInstanceConfirm: "Overwrite",
			toastInstanceOverwritten: "Instance overwritten",
			toastServiceRunningCannotOverwrite: "The service instance of this session is running; stop it before overwriting",
			sessionLabelWorkflowPrefix: "Workflow instance: ",
			combos: "Combos",
			comboManager: "Combo Manager",
			comboTabDsh: "Tools",
			comboTabTool: "items",
			comboTabMcp: "MCP servers",
			comboSearch: "Search tools by name or description…",
			comboSearchEmpty: "No matching tools (search by name or Chinese description)",
			comboNew: "New combo",
			comboName: "Combo name",
			comboDelete: "Delete combo",
			comboHint: "Tick tools and MCP servers to form a mode config",
			comboEmptySelection: "No tools or MCP selected yet",
			comboEmpty: "No combos yet — click \"New combo\"",
			comboSaved: "Combo saved",
			comboDeleted: "Combo deleted",
			comboSaveFirst: "Name the combo first",
			comboTagDisableAll: "Disable all",
			comboTagEnableAll: "Enable all",
			comboTagBulkHint: "Toggle all tools under the current tag (official tools and other tags are unaffected)",
			toolSwitchBatchEnabled: "Enabled all tools under the current tag",
			toolSwitchBatchDisabled: "Disabled all tools under the current tag",
			loadedPluginsLabel: "Loaded {count} plugins (their tools are listed above for individual selection)",
			mcpNew: "New MCP server",
			mcpEdit: "Edit",
			mcpName: "Server name",
			mcpTransport: "Transport",
			mcpTransportStdio: "stdio (local command)",
			mcpTransportHttp: "streamable-http (remote URL)",
			mcpCommand: "Command (paste the whole line)",
			mcpArgs: "Extra args (merged into command)",
			mcpEnv: "Environment (JSON, optional)",
			mcpHeaders: "Headers (JSON, optional)",
			mcpCommandHint: "How to fill: ① Local script: node <script path> [flags]　② npx one-liner: npx -y <pkg> [flags] (auto-launched via cmd on Windows)　③ Remote: pick streamable-http + enter URL. Quote any path with spaces.",
			mcpImport: "Import from mcp.json",
			mcpImportApply: "Import",
			mcpImportHint: "Paste a standard mcp.json server object or {mcpServers:{name:{...}}}; review before saving.",
			mcpImported: "Imported — review then save",
			mcpUrl: "URL",
			mcpSave: "Save server",
			mcpDelete: "Delete",
			mcpEnable: "Enable",
			mcpDisable: "Disable",
			mcpEnabled: "MCP server enabled (restart dsh web to apply)",
			mcpDisabled: "MCP server disabled (restart dsh web to apply)",
			mcpSaved: "MCP server saved (restart dsh web to apply)",
			mcpDeleted: "MCP server deleted (restart dsh web to apply)",
			mcpRestartHint: "MCP changes are written to the profile config; restart dsh web to apply",
			presetCustom: "Custom list",
			comboDeleteConfirm: "Confirm delete",
			toolEnable: "Enable",
			toolDisable: "Disable",
			toolSwitchEnabled: "Tool enabled: visible to parent agents in every session",
			toolSwitchDisabled: "Tool disabled: hidden from parent agents and their subagents in every session",
			scheduler: "Schedule",
			schedulerManager: "Scheduled Tasks",
			schedulerHint: "Auto-run the selected workflow by execution window and trigger strategy (trigger = create instance and run)",
			schedulerNew: "New task",
			schedulerName: "Task name",
			schedulerTemplate: "Workflow",
			schedulerTemplatePlaceholder: "Choose a mode-1 workflow template…",
			schedulerTemplateEmpty: "No mode-1 workflow templates yet (create one via \"Save as template\" in the studio)",
			schedulerSessionMode: "Run session",
			schedulerSessionNew: "New session (auto-create a session per round)",
			schedulerSessionCurrent: "Current session (reuse this session each round)",
			schedulerSessionNewHint: "Each round creates a fresh session (run does not depend on a manually activated session); a paused unfinished run continues within its current session",
			schedulerSessionCurrentHint: "Each round reuses the session that created this task; if the session is inactive the trigger fails and skips the round",
			schedulerTimezone: "Timezone",
			schedulerWindow: "Execution window (layer 1)",
			schedulerWindowHint: "Cost-shift window: the trigger only fires inside it; a run still unfinished at window end is suspended and resumes at the next window",
			schedulerWindowDates: "Valid date range",
			schedulerWindowDateStart: "Start date",
			schedulerWindowDateEnd: "End date",
			schedulerWindowUnbounded: "No date limit",
			schedulerWindowDays: "Valid weekdays",
			schedulerWindowDaysAll: "Every day",
			schedulerWindowRanges: "Executable time ranges",
			schedulerRangeStart: "Start time",
			schedulerRangeEnd: "End time",
			schedulerRangeAdd: "Add range",
			schedulerRangeCrossHint: "An end time not later than the start is treated as crossing midnight (e.g. 22:00–06:00 covers next-day early morning)",
			schedulerTrigger: "Trigger strategy (layer 2)",
			schedulerTriggerDaily: "Fixed times",
			schedulerTriggerInterval: "Fixed interval",
			schedulerTimePoints: "Trigger times",
			schedulerTimePointAdd: "Add time",
			schedulerInterval: "Interval (minutes)",
			schedulerIntervalStartFrom: "Start from",
			schedulerIntervalHint: "Each valid day counts from the start time; points crossing next-day 00:00 are dropped",
			schedulerPolicy: "Runtime policy",
			schedulerPolicyText: "Missed trigger: skip (no catch-up) · Busy round: skip · Config change: immediate",
			schedulerEnabled: "Enabled",
			schedulerNextRun: "Next trigger",
			schedulerCurrentRun: "Current run",
			schedulerLastOutcome: "Last result",
			schedulerEmpty: "No scheduled tasks yet — click \"New task\" to start",
			schedulerStatus: {
				idle: "Idle",
				running: "Running",
				waiting: "Window paused",
				paused: "Paused",
				error: "Trigger failed"
			},
			schedulerLastResult: {
				started: "Started",
				resumed: "Window resumed",
				failed: "Trigger failed",
				skipped: "Skipped (busy)"
			},
			schedulerDelete: "Delete task",
			schedulerDeleteConfirm: "Confirm delete",
			schedulerDeleteHint: "Deleting only affects future triggers; a running/paused run is untouched",
			schedulerSaved: "Task saved",
			schedulerDeleted: "Task deleted",
			schedulerSaveFirst: "Save the task first (new task auto-selected)",
			schedulerNeedName: "Please enter a task name",
			schedulerNeedTemplate: "Please choose a workflow template",
			schedulerDraftUnsaved: "Unsaved changes",
			schedulerError: "Failed to save task"
		};
		function text(language) {
			return String(language ?? "").toLowerCase().startsWith("zh") ? zh : en;
		}
		/** 从 locale 服务取值中提取语言码（防御式）。 */
		function detectLanguage(locale, navigatorLanguage) {
			try {
				if (typeof locale === "string") return locale;
				if (locale && typeof locale === "object") {
					const record = locale;
					if (typeof record.language === "string") return record.language;
					if (typeof record.current === "string") return record.current;
					if (typeof record.get === "function") {
						const value = record.get("language");
						if (typeof value === "string") return value;
					}
					if (typeof record.getSnapshot === "function") {
						const snapshot = record.getSnapshot();
						if (snapshot && typeof snapshot.active === "string") return snapshot.active;
					}
					if (typeof record.getLocale === "function") {
						const snapshot = record.getLocale();
						if (snapshot && typeof snapshot.active === "string") return snapshot.active;
					}
				}
			} catch {}
			try {
				return typeof navigator !== "undefined" ? navigator.language ?? navigatorLanguage ?? "en" : navigatorLanguage ?? "en";
			} catch {
				return navigatorLanguage ?? "en";
			}
		}
		//#endregion
		//#region src/client/styles.ts
		const styles = `
:root,.wf-root{--wf-border:var(--dsw-alias-border-l1);--wf-border-strong:var(--dsw-alias-border-l2);--wf-bg:var(--dsw-alias-bg-base);--wf-layer:var(--dsw-alias-bg-layer-1);--wf-layer-2:var(--dsw-alias-bg-layer-2);--wf-brand:var(--dsw-alias-brand-primary);--wf-on-brand:var(--dsw-alias-label-primary-inverse,var(--dsw-alias-label-reverse,#ffffff));--wf-ink:var(--dsw-alias-label-primary);--wf-ink-2:var(--dsw-alias-label-secondary);--wf-ok:var(--dsw-alias-state-success-primary);--wf-warn:var(--dsw-alias-state-warn-primary);--wf-err:var(--dsw-alias-state-error-primary);--wf-flow:#9aa7b8;--wf-context:#d9a441;--wf-database:#4a9fd8;--wf-pass:#3fbf7f;--wf-fail:#e05c5c;--wf-content:#9a7fd0;--wf-port-in:#3d8bfd;--wf-port-out:#ff8a4c}
.wf-root{position:relative;inset:auto;width:100%;height:100%;max-height:100vh;min-height:0;display:grid;grid-template-rows:48px minmax(0,1fr) auto;background:var(--wf-bg);color:var(--wf-ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.wf-root *{box-sizing:border-box}
.wf-root button,.wf-root input,.wf-root select,.wf-root textarea{font:inherit}
.wf-root button{cursor:pointer}
.wf-tabs{display:flex;align-items:center;gap:10px;padding:0 20px;background:var(--wf-layer);border-bottom:1px solid var(--wf-border);flex:none;min-width:0}
.wf-titlebar__title{font-size:14px;font-weight:720;color:var(--wf-ink);white-space:nowrap}
.wf-titlebar__badge{padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--wf-brand) 10%,transparent);color:var(--wf-brand);font-size:10px;font-weight:700;white-space:nowrap}
.wf-titlebar__note{color:var(--wf-ink-2);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-titlebar__spacer{margin-left:auto;flex:1}
.wf-titlebar__mode{position:relative;flex:none}
.wf-titlebar__caret{margin-left:4px;font-size:9px;color:var(--wf-ink-2)}
.wf-titlebar__close{margin-left:2px}
.wf-mode-menu{position:absolute;z-index:60;right:0;top:calc(100% + 6px);min-width:170px;padding:6px;border:1px solid var(--wf-border-strong);border-radius:10px;background:var(--wf-layer);box-shadow:0 14px 34px color-mix(in srgb,var(--wf-ink) 22%,transparent);display:flex;flex-direction:column;gap:4px}
.wf-mode-menu__item{text-align:left;border:0;border-radius:7px;background:transparent;color:var(--wf-ink);padding:7px 10px;font-size:12px}
.wf-mode-menu__item:hover{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer));color:var(--wf-brand)}
.wf-main{min-height:0;min-width:0;overflow:hidden;display:flex}
.wf-toolbar{flex:none;height:52px;min-height:52px;display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--wf-layer);border-bottom:1px solid var(--wf-border);flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.wf-toolbar>*{flex:none}
.wf-toolbar__switch{display:inline-flex;align-items:center;gap:5px;color:var(--wf-ink-2);font-size:10px;cursor:pointer;white-space:nowrap}
.wf-toolbar__switch input{width:auto;flex:0 0 auto;min-width:0;margin:0;accent-color:var(--wf-brand);cursor:pointer}
.wf-toolbar__workspace{width:200px;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:5px 8px;font-size:10px;outline:0}
.wf-toolbar__workspace:focus{border-color:var(--wf-brand)}
/* 顶部一键折叠/展开两侧按钮（批注：折叠时图标泛品牌色，提示当前可展开） */
.wf-toolbar__panels svg{color:var(--wf-ink-2)}
.wf-toolbar__panels.is-collapsed{border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border-strong))}
.wf-toolbar__panels.is-collapsed svg{color:var(--wf-brand)}
.wf-btn{border:1px solid var(--wf-border-strong);border-radius:8px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 11px;transition:border-color .15s ease,transform .15s ease,background .15s ease;white-space:nowrap}
.wf-btn:hover{border-color:var(--wf-brand);transform:translateY(-1px)}
/* 主按钮：采用 DSH 官方主按钮语义（--dsw-alias-button-primary-fill 与
   --dsw-alias-label-primary-foreground）：深色主题=浅底深字、浅色主题=深底白字，
   无论主题如何都保持文字可见（此前 fallback #fff 在深色主题浅底上白字不可见） */
.wf-btn.is-primary{border-color:var(--dsw-alias-button-primary-fill,var(--wf-brand));background:var(--dsw-alias-button-primary-fill,var(--wf-brand,#4f7cff));color:var(--dsw-alias-label-primary-foreground,var(--wf-bg,#15181d));font-weight:650}
.wf-btn.is-primary:hover{border-color:var(--dsw-alias-button-primary-hover,var(--wf-brand))}
.wf-btn.is-danger{border-color:color-mix(in srgb,var(--wf-err) 55%,var(--wf-border-strong));color:var(--wf-err)}
.wf-btn.is-danger:hover{border-color:var(--wf-err)}
.wf-btn.is-ghost{background:transparent}
.wf-btn:disabled{opacity:.5;cursor:default}
.wf-status{color:var(--wf-ink-2);font-size:12px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38%}
.wf-status.is-running{color:var(--wf-ok)}
.wf-canvas-shell{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--wf-bg);overflow:hidden}
.wf-canvas-stage{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.wf-canvas{flex:1;min-height:0;position:relative;overflow:hidden;touch-action:none;user-select:none;background-color:var(--wf-bg);background-image:radial-gradient(circle,var(--wf-border-strong) 1.1px,transparent 1.2px),radial-gradient(circle at 50% 0%,color-mix(in srgb,var(--wf-brand) 6%,transparent),transparent 42%);background-size:24px 24px,100% 100%;cursor:grab}
.wf-canvas.is-panning{cursor:grabbing}
.wf-graph__stage{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0;will-change:transform}
.wf-graph__edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.wf-graph__edge{fill:none!important;stroke:var(--wf-flow);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 2px color-mix(in srgb,var(--wf-flow) 30%,transparent));pointer-events:none}
.wf-graph__edge.is-selected{stroke-width:3.6;filter:drop-shadow(0 0 4px color-mix(in srgb,var(--wf-brand) 58%,transparent))}
.wf-graph__edge.is-ctx{stroke:var(--wf-context)}
.wf-graph__edge.is-db{stroke:var(--wf-database)}
.wf-graph__edge.is-pass{stroke:var(--wf-pass)}
.wf-graph__edge.is-fail{stroke:var(--wf-fail)}
.wf-graph__edge.is-content{stroke:var(--wf-content)}
.wf-arrow-head{fill:var(--wf-flow);stroke:none}
.wf-arrow-head.is-pass{fill:var(--wf-pass)}
.wf-arrow-head.is-fail{fill:var(--wf-fail)}
.wf-arrow-head.is-content{fill:var(--wf-content)}
.wf-graph__edge.is-running{stroke-dasharray:8 5}
.wf-graph__edge-hit{fill:none!important;stroke:transparent;stroke-width:18;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:pointer}
.wf-graph__connection{fill:none!important;stroke:var(--wf-brand);stroke-width:2;stroke-dasharray:7 5;vector-effect:non-scaling-stroke;pointer-events:none}
.wf-graph__label-bg{fill:var(--wf-layer);stroke:var(--wf-border);stroke-width:1;vector-effect:non-scaling-stroke}
.wf-graph__label{fill:var(--wf-ink);font-size:10px;font-weight:750;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
.wf-graph__node{position:absolute;width:208px;height:116px;pointer-events:auto;cursor:grab}
.wf-graph__node.is-dragging{cursor:grabbing}
.wf-graph__handle{position:absolute;z-index:4;top:50%;width:13px;height:13px;padding:0;border:2px solid var(--wf-bg);border-radius:50%;background:var(--wf-brand);transform:translateY(-50%);cursor:crosshair;box-shadow:0 0 0 1px color-mix(in srgb,var(--wf-brand) 65%,var(--wf-border-strong));transition:transform .14s ease,box-shadow .14s ease}
.wf-graph__handle:hover,.wf-graph__handle:focus-visible{transform:translateY(-50%) scale(1.18);box-shadow:0 0 0 5px color-mix(in srgb,var(--wf-brand) 18%,transparent);outline:0}
/* 接点左右位置：普通卡片（角色/文件/数据库/阶段/虚拟）按交换状态动态指定 side；协作组卡固定 target/source */
.wf-graph__handle.is-side-left{left:-6px}
.wf-graph__handle.is-side-right{right:-6px}
/* 接点颜色区分入口/出口（用户批注：入口=蓝、出口=橙；位置由交换决定，颜色标识方向） */
.wf-graph__handle.is-in{background:var(--wf-port-in)}
.wf-graph__handle.is-out{background:var(--wf-port-out)}
.wf-graph__handle--target{left:-6px;background:var(--wf-port-in)}
.wf-graph__handle--source{right:-6px;background:var(--wf-port-out)}
.wf-graph__controls{position:absolute;z-index:8;left:12px;bottom:12px;display:grid;border:1px solid var(--wf-border-strong);border-radius:9px;overflow:hidden;background:var(--wf-layer);box-shadow:0 8px 20px color-mix(in srgb,var(--wf-ink) 9%,transparent)}
.wf-graph__controls button{width:32px;height:30px;border:0;border-bottom:1px solid var(--wf-border);background:var(--wf-layer-2);color:var(--wf-ink);font-weight:750}
.wf-graph__controls button:last-child{border-bottom:0}
.wf-graph__controls button:hover{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer-2));color:var(--wf-brand)}
.wf-node{width:100%;height:100%;padding:12px 14px;border:1px solid var(--wf-border-strong);border-radius:12px;background:color-mix(in srgb,var(--wf-layer) 96%,var(--wf-brand) 4%);color:var(--wf-ink);box-shadow:0 8px 24px color-mix(in srgb,var(--wf-ink) 9%,transparent);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease;overflow:hidden}
.wf-node:hover{border-color:color-mix(in srgb,var(--wf-brand) 55%,var(--wf-border-strong));box-shadow:0 12px 30px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-node.is-selected{border-color:var(--wf-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-brand) 18%,transparent),0 12px 30px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-node.is-highlighted{border-color:var(--wf-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-brand) 26%,transparent),0 0 18px color-mix(in srgb,var(--wf-brand) 30%,transparent)}
.wf-node.is-proxy{border-style:dashed;border-color:var(--wf-warn)}
.wf-node__kind{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--wf-ink-2);margin-bottom:2px;display:flex;align-items:center;gap:6px}
.wf-node__label{font-weight:650;font-size:13px;word-break:break-word;display:flex;align-items:center;gap:6px}
.wf-node__proxy-badge{flex:none;font-size:9px;font-weight:750;color:var(--wf-warn);border:1px solid var(--wf-warn);border-radius:999px;padding:0 5px;line-height:15px}
.wf-node__prompt{margin-top:5px;font-size:11px;color:var(--wf-ink-2);white-space:pre-wrap;max-height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
/* 卡片右上角「交换左右连接点」按钮（用户批注：美化布线防交叉；交换后连线端点随之换向） */
.wf-node__swap{position:absolute;z-index:5;top:7px;right:8px;width:22px;height:22px;min-width:22px;padding:0;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink-2);font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .14s ease,color .14s ease}
.wf-node__swap:hover{border-color:var(--wf-brand);color:var(--wf-brand)}
.wf-node__swap.is-active{border-color:var(--wf-brand);color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer-2))}
/* 画布左上角工作流名称角标（用户批注：模板/实例 + 名称；固定不随缩放平移） */
.wf-canvas-caption{position:absolute;z-index:7;top:12px;left:14px;max-width:46%;padding:5px 11px;border:1px solid var(--wf-border-strong);border-radius:9px;background:var(--wf-layer);color:var(--wf-ink-2);font-size:11px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 6px 16px color-mix(in srgb,var(--wf-ink) 8%,transparent)}
.wf-canvas-caption strong{color:var(--wf-ink);font-weight:720}
.wf-node--parent .wf-node__kind{color:var(--wf-brand)}
.wf-node--agent .wf-node__kind{color:var(--wf-brand)}
.wf-node--file .wf-node__kind{color:var(--wf-ink-2)}
.wf-node--database .wf-node__kind{color:var(--wf-database)}
.wf-node--start .wf-node__kind{color:var(--wf-ok)}
.wf-node--end .wf-node__kind{color:var(--wf-err)}
.wf-node--pause .wf-node__kind{color:var(--wf-warn)}
.wf-node--group .wf-node__kind{color:var(--wf-warn)}
.wf-node--group{display:flex;flex-direction:column;padding:10px 12px}
.wf-group-node{width:300px;height:220px}
/* 拖拽悬停入组高亮（用户验收标注：卡片插入协作组卡片区域即识别为入组） */
.wf-group-node.is-drop-target .wf-node--group{border-color:var(--wf-pass);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-pass) 26%,transparent),0 0 22px color-mix(in srgb,var(--wf-pass) 32%,transparent)}
.wf-group__drop-hint{flex:none;margin:6px 0 2px;padding:4px 8px;border:1px dashed var(--wf-pass);border-radius:8px;color:var(--wf-pass);font-size:10px;font-weight:700;text-align:center;pointer-events:none}
/* 已选文件列表（文件表单，按钮下方显示；用户验收标注） */
.wf-file-list{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);max-height:120px;overflow:auto;scrollbar-width:thin}
.wf-file-chip{display:block;font-size:11px;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:6px;background:color-mix(in srgb,var(--wf-brand) 8%,transparent)}
.wf-group__members{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:5px;margin-top:6px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);scrollbar-width:thin}
/* 组内成员 = 缩小版角色卡：仅名称+状态，数据库/上下文接点，无流程接点（用户批注 Q2） */
.wf-group__member{position:relative;display:flex;align-items:center;gap:6px;min-height:36px;border:1px solid var(--wf-border-strong);border-radius:8px;background:color-mix(in srgb,var(--wf-layer) 90%,var(--wf-brand) 10%);color:var(--wf-ink);padding:6px 10px;font-size:11px;text-align:left;box-shadow:0 2px 6px color-mix(in srgb,var(--wf-ink) 8%,transparent);transition:border-color .16s ease,box-shadow .16s ease}
.wf-group__member:hover{border-color:color-mix(in srgb,var(--wf-brand) 55%,var(--wf-border-strong));box-shadow:0 2px 10px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-graph__handle--mini{width:9px;height:9px;border-width:1px}
.wf-graph__handle--mini:hover{transform:translateY(-50%) scale(1.25)}
.wf-group__member-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:650}
.wf-group__member-status{display:inline-flex;align-items:center;gap:3px;flex:none;font-size:10px;color:var(--wf-ink-2);padding:1px 6px;border:1px solid var(--wf-border-strong);border-radius:6px;background:color-mix(in srgb,var(--wf-layer) 92%,var(--wf-ink) 8%)}
.wf-group__resize{position:absolute;z-index:6;right:-4px;bottom:-4px;width:14px;height:14px;border-right:3px solid var(--wf-border-strong);border-bottom:3px solid var(--wf-border-strong);border-radius:0 0 6px 0;cursor:nwse-resize}
.wf-group__resize:hover{border-color:var(--wf-brand)}
.wf-canvas-empty{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.wf-canvas-empty__hint{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--wf-ink-2);font-size:12px;text-align:center;opacity:.85}
.wf-canvas-empty__icon{width:52px;height:52px;border:1px dashed var(--wf-border-strong);border-radius:16px;display:grid;place-items:center;font-size:22px;color:var(--wf-brand)}
.wf-docrail{flex:none;width:auto;display:flex;flex-direction:column;background:var(--wf-layer);min-height:0;overflow:hidden}
.wf-docrail.is-collapsed{visibility:hidden;pointer-events:none;width:0}
.wf-docrail__list{flex:1 1 0;height:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:9px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}
.wf-lib-tabs{flex:none;display:flex;gap:4px;padding:8px 10px 0;border-bottom:1px solid var(--wf-border)}
.wf-lib-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:9px 9px 0 0;background:transparent;color:var(--wf-ink-2);padding:7px 4px;font-size:11px;font-weight:650;cursor:pointer}
.wf-lib-tab:hover{color:var(--wf-ink);background:color-mix(in srgb,var(--wf-brand) 6%,transparent)}
.wf-lib-tab.is-active{color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,transparent);box-shadow:inset 0 -2px 0 var(--wf-brand)}
/* ---- 底栏（新增；与左栏相互切换；卡片横向 flex-wrap 动态追加排） ---- */
.wf-bottom-area{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.wf-bottombar{flex:none;display:flex;flex-direction:row;background:var(--wf-layer);border-top:1px solid var(--wf-border);min-height:0;overflow:hidden}
.wf-bottombar.is-collapsed{visibility:hidden;pointer-events:none;height:0}
/* Tag 区：位于底栏【左侧】（竖向排布），但每个 Tag 文字是【横向】的（工作流/角色/数据/其他），不显示图标 */
.wf-bottombar__tags{flex:none;width:88px;display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:8px 6px;border-right:1px solid var(--wf-border)}
.wf-bottombar__tag{border:1px solid transparent;border-radius:8px;background:transparent;color:var(--wf-ink-2);padding:7px 8px;font-size:11px;font-weight:650;cursor:pointer;white-space:nowrap;text-align:center}
.wf-bottombar__tag:hover{color:var(--wf-ink);background:color-mix(in srgb,var(--wf-brand) 6%,transparent)}
.wf-bottombar__tag.is-active{color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,transparent);border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border))}
.wf-bottombar__scroll{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 12px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}
.wf-bottombar__section{display:flex;flex-direction:column;gap:6px}
.wf-bottombar__group{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--wf-ink-2)}
.wf-bottombar__group-title{flex:none;white-space:nowrap}
.wf-bottombar__cards{display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start}
/* 底栏卡片：只显示名称（图片批注：不再显示描述和其他内容，包括图标） */
.wf-hcard{max-width:180px;min-width:96px;height:32px;padding:0 12px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);color:var(--wf-ink);font-size:11px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;touch-action:none;transition:border-color .14s ease,background .14s ease}
.wf-hcard:hover{border-color:color-mix(in srgb,var(--wf-brand) 55%,var(--wf-border-strong))}
.wf-hcard.is-active{border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border));background:color-mix(in srgb,var(--wf-brand) 12%,var(--wf-layer));color:var(--wf-brand)}
.wf-hcard__name{display:block;width:100%;overflow:hidden;text-overflow:ellipsis}
/* 底栏上边界拖动线（水平、位于底栏顶部，上下调整大小；图片批注：边界线同样可拖动）。
   双类选择器覆盖 .wf-splitter 的竖向默认（width:9px/col-resize），确保为横向。 */
.wf-splitter.wf-splitter--horizontal{position:relative;z-index:12;flex:none;min-width:0;width:auto;min-height:8px;height:8px;cursor:row-resize;touch-action:none;background:var(--wf-layer-2);outline:0;border-top:1px solid var(--wf-border)}
.wf-splitter.wf-splitter--horizontal::before{content:"";position:absolute;inset:3px 0;background:var(--wf-border)}
.wf-splitter.wf-splitter--horizontal:hover::before,.wf-splitter.wf-splitter--horizontal:focus-visible::before,.wf-splitter.wf-splitter--horizontal.is-dragging::before{inset:2px 0;background:var(--wf-brand)}
.wf-docgroup{display:flex;align-items:center;justify-content:space-between;padding:5px 7px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--wf-ink-2)}
.wf-docgroup__add{width:20px;height:20px;min-width:20px;border:1px solid var(--wf-border-strong);border-radius:6px;background:transparent;color:var(--wf-ink-2);font-size:13px;line-height:0;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer}
.wf-docgroup__add:hover{border-color:var(--wf-brand);color:var(--wf-brand)}
.wf-docitem{width:100%;display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:9px;align-items:center;text-align:left;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--wf-ink);padding:8px;cursor:grab;touch-action:none}
.wf-docitem:hover{background:var(--wf-layer-2);border-color:var(--wf-border)}
.wf-docitem.is-active{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer));border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border));color:var(--wf-brand)}
.wf-docitem.is-pinned{background:color-mix(in srgb,var(--wf-brand) 6%,var(--wf-layer));border-color:color-mix(in srgb,var(--wf-brand) 28%,var(--wf-border))}
.wf-docitem__icon{width:26px;height:30px;border:1px solid currentColor;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;opacity:.76}

.wf-docitem__texts {display: flex;flex-direction: column;gap: 3px;min-width: 0;}
.wf-docitem__title-row{display: flex;align-items: center;gap: 6px;min-width: 0;}
.wf-docitem__title-row .wf-docitem__label{flex: 0 1 auto;min-width: 0;}
.wf-docitem__title-row .wf-docitem__badge{flex: none;margin-left: 0;}

.wf-docitem__label{display:block;font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-docitem__path{display:block;font:9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-docitem__badge{justify-self:end;white-space:nowrap;font-size:10px;font-weight:700;color:var(--wf-ok);border:1px solid color-mix(in srgb,var(--wf-ok) 40%,var(--wf-border));border-radius:6px;padding:2px 7px;background:color-mix(in srgb,var(--wf-ok) 12%,transparent)}
/* 工作台全局化：「当前」徽标（当前主会话对应的实例；品牌色以区分普通状态徽标） */
.wf-docitem__badge.is-current{color:var(--wf-brand);border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border));background:color-mix(in srgb,var(--wf-brand) 12%,transparent)}
.wf-drag-preview{position:fixed;z-index:999;pointer-events:none;min-width:150px;max-width:230px;padding:9px 12px;border:1px solid var(--wf-brand);border-radius:10px;background:color-mix(in srgb,var(--wf-layer) 94%,var(--wf-brand) 6%);color:var(--wf-ink);font-size:12px;font-weight:650;box-shadow:0 14px 34px color-mix(in srgb,var(--wf-ink) 22%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-inspector{flex:none;width:auto;height:100%;max-height:100%;display:flex;flex-direction:column;background:var(--wf-layer);overflow:hidden;min-height:0}
.wf-inspector__scroll{flex:1 1 0;height:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:15px;display:flex;flex-direction:column;gap:11px;scrollbar-width:thin}
.wf-inspector__scroll>*{flex-shrink:0}
.wf-inspector.is-collapsed{visibility:hidden;pointer-events:none;padding:0;width:0!important}
.wf-inspector h3{margin:0;font-size:14px;color:var(--wf-ink)}
.wf-inspector label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:12px}
.wf-inspector input,.wf-inspector select,.wf-inspector textarea{width:100%;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-inspector input:focus,.wf-inspector select:focus,.wf-inspector textarea:focus{border-color:var(--wf-brand)}
.wf-inspector textarea{min-height:92px;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55}
.wf-inspector__footer{flex:none;display:flex;align-items:center;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border);background:var(--wf-layer)}
.wf-inspector__footer .wf-btn{font-size:11px;padding:5px 11px}
.wf-inspector .wf-empty{color:var(--wf-ink-2);font-size:12px}
.wf-field{display:flex;flex-direction:column;gap:4px}
.wf-check-list{max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);scrollbar-width:thin}
.wf-check-list label{display:flex;align-items:center;gap:7px;color:var(--wf-ink);font-size:11px}
.wf-hint{color:var(--wf-ink-2);font-size:11px}
.wf-advanced{border:1px solid var(--wf-border);border-radius:9px;background:var(--wf-layer-2);padding:0 9px;margin:12px 0 0}
.wf-advanced summary{cursor:pointer;padding:8px 0;color:var(--wf-ink-2);font-size:11px;font-weight:650}
.wf-advanced__content{display:grid;gap:9px;padding:0 0 10px}
.wf-pathbox{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border:1px solid var(--wf-border);border-radius:9px;background:var(--wf-layer-2)}
.wf-pathbox__label{font-size:10px;color:var(--wf-ink-2)}
.wf-pathbox__value{font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink);word-break:break-all}
.wf-iconbtn{width:32px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:16px}
.wf-splitter{position:relative;z-index:12;flex:none;min-width:9px;width:9px;cursor:col-resize;touch-action:none;background:var(--wf-layer);outline:0}
.wf-splitter::before{content:"";position:absolute;inset:0 3px;background:var(--wf-border)}
.wf-splitter:hover::before,.wf-splitter:focus-visible::before,.wf-splitter.is-dragging::before{inset:0 2px;background:var(--wf-brand)}
.wf-confirm-backdrop{position:absolute;z-index:40;inset:0;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-confirm{width:min(540px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent)}
.wf-confirm h3{margin:0 0 8px;font-size:15px;color:var(--wf-ink)}
.wf-confirm p{margin:0;color:var(--wf-ink-2);font-size:12px;line-height:1.65;white-space:pre-wrap}
.wf-confirm__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}
.wf-history-backdrop{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-history{width:min(760px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;padding:18px;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent)}
.wf-history h3{margin:0 0 10px;font-size:15px;color:var(--wf-ink)}
.wf-history__list{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}
.wf-history__item{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid var(--wf-border);border-radius:10px;background:var(--wf-layer-2);padding:9px 11px;cursor:pointer}
.wf-history__item:hover{border-color:var(--wf-brand)}
.wf-history__item.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-history__title{font-size:12px;font-weight:650;color:var(--wf-ink);display:flex;align-items:center;gap:6px}
.wf-history__chain{font-size:9px;color:var(--wf-ink-2);border:1px solid var(--wf-border);border-radius:999px;padding:0 6px}
.wf-history__meta{font:9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink-2)}
.wf-history__resume{align-self:flex-end}
.wf-history__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.wf-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:var(--wf-ink-2)}
.wf-status-dot.is-running{background:var(--wf-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-ok) 18%,transparent)}
.wf-status-dot.is-ok{background:var(--wf-ok)}
.wf-status-dot.is-fail{background:var(--wf-err)}
.wf-status-dot.is-armed{background:var(--wf-warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-warn) 16%,transparent)}
.wf-status-dot.is-pending{background:var(--wf-ink-2)}
.wf-status-dot.is-skipped{background:var(--wf-ink-2);opacity:.6}
.wf-status-dot.is-react-capped{background:var(--wf-context)}
.wf-status-dot.is-paused,.wf-status-dot.is-interrupted{background:var(--wf-warn)}
.wf-import-hidden{display:none}
.wf-toast-host{position:fixed;z-index:9999;top:56px;right:16px;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.wf-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;min-width:190px;max-width:330px;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5;box-shadow:0 12px 32px color-mix(in srgb,var(--wf-ink) 22%,transparent);animation:wf-toast-in .18s ease}
.wf-toast.is-success{background:color-mix(in srgb,var(--wf-ok) 16%,var(--wf-layer));border:1px solid color-mix(in srgb,var(--wf-ok) 55%,var(--wf-border-strong));color:var(--wf-ink)}
.wf-toast.is-error{background:color-mix(in srgb,var(--wf-err) 14%,var(--wf-layer));border:1px solid color-mix(in srgb,var(--wf-err) 55%,var(--wf-border-strong));color:var(--wf-ink)}
.wf-toast.is-info{background:var(--wf-layer);border:1px solid var(--wf-border-strong);color:var(--wf-ink)}
.wf-toast__dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px}
.wf-toast.is-success .wf-toast__dot{background:var(--wf-ok)}
.wf-toast.is-error .wf-toast__dot{background:var(--wf-err)}
.wf-toast.is-info .wf-toast__dot{background:var(--wf-brand)}
@keyframes wf-toast-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.wf-message{position:absolute;z-index:25;left:50%;bottom:18px;transform:translateX(-50%);max-width:70%;padding:8px 14px;border:1px solid var(--wf-border-strong);border-radius:10px;background:var(--wf-layer);color:var(--wf-ink-2);font-size:12px;box-shadow:0 10px 26px color-mix(in srgb,var(--wf-ink) 14%,transparent)}
.wf-window{position:fixed;z-index:2147483000;display:flex;flex-direction:column;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-bg);box-shadow:0 34px 90px color-mix(in srgb,var(--wf-ink) 34%,transparent);overflow:hidden;overflow-wrap:anywhere}
.wf-window__body{flex:1;min-height:0;display:flex}
/* 统一窗口框架内容容器（WorkbenchFrame）：恒为框架根的第 0 个子节点，float/split 共用；
   取代 .wf-window__body / .wf-split-pane__content 的内容容器角色，保证 Studio 跨模式挂载 */
.wf-frame-content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
/* 分栏形态：分隔线 absolute 覆盖在左缘，内容容器左移 9px 让位（与旧 .wf-split-pane__inner 布局一致） */
.wf-split-pane .wf-frame-content{padding-left:9px}
.wf-window .wf-tabs{cursor:grab}
.wf-window .wf-tabs button,.wf-window .wf-tabs input,.wf-window .wf-tabs select{cursor:pointer}
.wf-window .wf-tabs .wf-titlebar__title{cursor:grab}
.wf-window__resize{position:absolute;z-index:5}
.wf-window__resize.is-n{top:-4px;left:12px;right:12px;height:8px;cursor:n-resize}
.wf-window__resize.is-s{bottom:-4px;left:12px;right:12px;height:8px;cursor:s-resize}
.wf-window__resize.is-e{right:-4px;top:12px;bottom:12px;width:8px;cursor:e-resize}
.wf-window__resize.is-w{left:-4px;top:12px;bottom:12px;width:8px;cursor:w-resize}
.wf-window__resize.is-ne{top:-5px;right:-5px;width:14px;height:14px;cursor:ne-resize}
.wf-window__resize.is-nw{top:-5px;left:-5px;width:14px;height:14px;cursor:nw-resize}
.wf-window__resize.is-se{bottom:-5px;right:-5px;width:14px;height:14px;cursor:se-resize}
.wf-window__resize.is-sw{bottom:-5px;left:-5px;width:14px;height:14px;cursor:sw-resize}
.wf-fab{position:fixed;right:22px;bottom:22px;z-index:2147482999;width:56px;height:56px;border:2px solid rgba(255,255,255,0.28);border-radius:50%;background:var(--wf-brand,#4f7cff);color:#ffffff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.35),0 0 0 4px rgba(79,124,255,0.18);transition:transform .16s ease,box-shadow .16s ease}
.wf-fab:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 14px 32px rgba(0,0,0,0.5),0 4px 10px rgba(0,0,0,0.4),0 0 0 6px rgba(79,124,255,0.24)}
.wf-fab:focus-visible{outline:3px solid #ffffff;outline-offset:2px}
.wf-combo-backdrop{position:absolute;z-index:35;inset:0;display:grid;place-items:center;padding:16px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-combo{width:min(1080px,94%);height:min(92%,760px);max-height:92%;display:flex;flex-direction:column;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent);overflow:hidden}
.wf-combo__search{flex:none;padding:8px 12px 0}
.wf-combo__search input{width:100%;border:1px solid var(--wf-border-strong);border-radius:8px;background:var(--wf-layer-2);color:var(--wf-ink);padding:7px 10px;outline:0}
.wf-combo__search input:focus{border-color:var(--wf-brand)}
.wf-combo__tags{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:8px 12px 0}
.wf-combo-tag{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border:1px solid var(--wf-border);border-radius:999px;background:var(--wf-layer-2);color:var(--wf-ink-2);font-size:10px;cursor:pointer;transition:border-color .14s ease,background .14s ease,color .14s ease}
.wf-combo-tag:hover{border-color:var(--wf-brand);color:var(--wf-ink)}
.wf-combo-tag.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 12%,var(--wf-layer-2));color:var(--wf-brand)}
.wf-combo-tag__bulk{margin-left:auto;border-color:var(--wf-border-strong);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2));color:var(--wf-ink);font-weight:650}
.wf-combo-tag__bulk:hover{border-color:var(--wf-brand);color:var(--wf-brand)}
.wf-combo-tag__bulk:disabled{opacity:.45;cursor:default}
.wf-combo__head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--wf-border)}
.wf-combo__head h3{margin:0;font-size:14px;color:var(--wf-ink);flex:none}
.wf-combo__head .wf-status{margin-left:0}
.wf-combo__close{margin-left:auto}
.wf-combo__body{flex:1;min-height:0;display:flex;overflow:hidden}
.wf-combo__catalog{flex:1.35;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--wf-border);overflow:hidden;position:relative;z-index:2}
.wf-combo__tabs{flex:none;display:flex;gap:4px;padding:8px 10px 0;border-bottom:1px solid var(--wf-border)}
.wf-combo__tab{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:9px 9px 0 0;background:transparent;color:var(--wf-ink-2);padding:7px 12px;font-size:11px;font-weight:650;cursor:pointer}
.wf-combo__tab:hover{color:var(--wf-ink)}
.wf-combo__tab.is-active{color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,transparent);box-shadow:inset 0 -2px 0 var(--wf-brand)}
.wf-combo__tab-count{padding:1px 6px;border-radius:999px;background:var(--wf-layer-2);font-size:9px;color:var(--wf-ink-2)}
.wf-combo__grid{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:8px;align-content:start;padding:12px;scrollbar-width:thin}
.wf-combo-card{display:flex;gap:9px;align-items:flex-start;text-align:left;border:1px solid var(--wf-border);border-radius:11px;background:var(--wf-layer-2);padding:10px 11px;cursor:pointer;transition:border-color .14s ease,background .14s ease}
.wf-combo-card:hover{border-color:var(--wf-brand)}
.wf-combo-card.is-checked{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-combo-card.is-disabled{opacity:.55;cursor:default;border-style:dashed}
.wf-combo-card.is-disabled .wf-combo-card__name{color:var(--wf-ink-2)}
.wf-combo-card input{flex:none;margin-top:2px;accent-color:var(--wf-brand)}
.wf-combo-card__body{min-width:0;display:flex;flex-direction:column;gap:3px}
.wf-combo-card__name{font-size:12px;font-weight:650;color:var(--wf-ink);word-break:break-all}
.wf-combo-card__desc{font-size:10px;line-height:1.45;color:var(--wf-ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wf-combo-card__badge{display:inline-block;align-self:flex-start;padding:1px 6px;border-radius:999px;background:var(--wf-layer);border:1px solid var(--wf-border);font-size:8px;color:var(--wf-ink-2)}
.wf-combo__side{flex:1;min-width:290px;max-width:380px;display:flex;flex-direction:column;overflow:hidden}
.wf-combo__side-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--wf-border)}
.wf-combo__side-head h4{margin:0;font-size:12px;color:var(--wf-ink);flex:1}
.wf-combo__side-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:6px;padding:10px 14px;scrollbar-width:thin}
.wf-combo-item{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--wf-border);border-radius:10px;background:var(--wf-layer-2);padding:8px 10px;cursor:pointer}
.wf-combo-item:hover{border-color:var(--wf-brand)}
.wf-combo-item.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-combo-item__label{flex:1;min-width:0;font-size:12px;font-weight:650;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-combo-item__meta{font-size:9px;color:var(--wf-ink-2)}
.wf-combo__edit{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--wf-border)}
.wf-combo__edit label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:11px}
.wf-combo__edit input{border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-combo__edit input:focus{border-color:var(--wf-brand)}
.wf-combo__selection{flex:none;max-height:120px;overflow:auto;display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px;border-top:1px solid var(--wf-border);scrollbar-width:thin}
.wf-combo-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer-2));border:1px solid color-mix(in srgb,var(--wf-brand) 35%,var(--wf-border));font-size:10px;color:var(--wf-ink)}
.wf-combo-chip button{border:0;background:transparent;color:var(--wf-ink-2);cursor:pointer;font-size:10px;line-height:1;padding:0}
.wf-combo-chip button:hover{color:var(--wf-err)}
.wf-combo__side-foot{flex:none;display:flex;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border)}
.wf-combo__side-foot .wf-btn{flex:1;font-size:11px;padding:6px 10px}
.wf-mcp-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--wf-border)}
.wf-mcp-form label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:11px}
.wf-mcp-form input{width:100%;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-mcp-form input:focus{border-color:var(--wf-brand)}
.wf-mcp-form__row{display:flex;gap:6px}
.wf-mcp-form__row .wf-btn{flex:1;font-size:11px;padding:6px 10px}
.wf-combo-hint{flex:none;padding:8px 14px;border-top:1px solid var(--wf-border);font-size:10px;color:var(--wf-ink-2);line-height:1.5}
.wf-service-console{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 12px;border-bottom:1px solid var(--wf-border);background:var(--wf-layer)}
.wf-service-console__head{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.wf-service-console__head strong{font-size:12px;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.wf-service-console__actions{display:flex;gap:7px;margin-left:auto}
.wf-service-console__debug{flex-basis:100%;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--wf-border);padding-top:7px}
.wf-service-console__debug-head{display:flex;align-items:center;gap:8px}
.wf-service-console__debug-title{font-size:11px;font-weight:600;color:var(--wf-ink)}
.wf-service-console__input{width:100%;resize:vertical;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0;font:inherit;font-size:12px;min-height:44px;box-sizing:border-box}
.wf-service-console__input:focus{border-color:var(--wf-brand)}
.wf-service-console__debug-actions{display:flex;gap:7px}
.wf-service-console__debug-actions .wf-btn{font-size:11px;padding:4px 10px}
.wf-service-console__output{flex:none;min-height:56px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;padding:8px;border:1px solid var(--wf-border);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);font:inherit;font-size:12px;line-height:1.6;box-sizing:border-box}
.wf-service-dot{width:9px;height:9px;border-radius:50%;flex:none}
.wf-service-dot.is-running{background:var(--wf-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-ok) 18%,transparent)}
.wf-service-dot.is-stopped{background:var(--wf-ink-2)}
.wf-service-dot.is-crashed{background:var(--wf-err)}
/* ---- 图1/图2 交互改造：侧边栏入口 / 标题栏窗口切换 / 分栏窗口 ---- */
/* 侧边栏入口：直接提取官方「设置」按钮样式（dsh-client-ui-settings-general 的 .VOzbGW_trigger）
   配置到 button.wf-sidebar-entry 上，使其与「设置」按钮视觉完全一致。*.wf-sidebar-entry 前缀
   提高、.wf-sidebar-entry 选择器特异性（0,1,1）确保覆盖任何复制来的官方 hashed 类；显式
   appearance:none / border:none / box-shadow:none 重置浏览器默认 button 外观（外圈边框/发光）。
   不依赖复制官方 className 呈现视觉，避免其在不同状态下引入外圈/发光。 */
button.wf-sidebar-entry{box-sizing:border-box;cursor:pointer;width:100%;min-width:0;height:42px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;box-shadow:none;align-items:center;gap:8px;margin:0;padding:0 10px 0 8px;font-family:inherit;font-size:14px;line-height:22px;display:flex;overflow:hidden;-webkit-appearance:none;appearance:none}
button.wf-sidebar-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wf-sidebar-entry__label{white-space:nowrap;overflow:hidden}
button.wf-sidebar-entry--rail{corner-shape:round;border-radius:50%;width:36px;height:36px;justify-content:center;gap:0;margin:0;padding:0}
.wf-sidebar-entry--rail .wf-sidebar-entry__label{display:none}
/* 清除聚焦/点击后的发光焦点环（含默认浏览器/主题 focus 圈），保持与设置按钮一致 */
button.wf-sidebar-entry:focus,
button.wf-sidebar-entry:focus-visible,
button.wf-sidebar-entry:active{outline:none;box-shadow:none;-webkit-tap-highlight-color:transparent}
.wf-titlebar__view{display:inline-flex;align-items:center;justify-content:center;padding:6px;margin-left:2px}
.wf-split-pane{position:fixed;top:0;right:0;bottom:0;width:var(--wf-split-w,640px);z-index:2147482010;display:flex;flex-direction:column;background:var(--wf-bg);border-left:1px solid var(--wf-border);min-height:0;overflow:hidden}
.wf-split-pane__inner{display:flex;width:100%;height:100%;min-width:0;min-height:0}
.wf-split-divider{position:relative;z-index:12;flex:none;width:9px;cursor:col-resize;touch-action:none}
.wf-split-divider::before{content:"";position:absolute;inset:0 3px;background:var(--wf-border)}
.wf-split-divider:hover::before,.wf-split-divider.is-dragging::before{inset:0 2px;background:var(--wf-ink-2)}
.wf-split-pane__content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
/* 分栏不修改官方 frame 网格（官方 frame 含 overlayLayer/handle 等子项，覆盖其 grid 会错位）。
   分栏时仅由 useWorkbenchView 给官方 centerCol 设右内边距（让出右半），工作台以 fixed 覆盖右侧。 */
@media(max-width:1180px){.wf-status{display:none}.wf-titlebar__note{display:none}}
@media(max-width:760px){.wf-toolbar{padding:7px}.wf-tabs{padding:0 10px}.wf-titlebar__badge{display:none}.wf-lib-tab{font-size:10px}.wf-confirm__actions .wf-btn{flex:1}}
/* ---- 定时任务（新功能本阶段；样式对齐组合管理 wf-combo 体系） ---- */
.wf-sched__form{flex:1.25;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--wf-border);overflow:hidden}
.wf-sched__form-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px;padding:12px 14px;scrollbar-width:thin}
.wf-sched__form-foot{flex:none;display:flex;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border)}
.wf-sched__form-foot .wf-btn{flex:1;font-size:11px;padding:6px 10px}
.wf-sched-field{display:grid;gap:4px;color:var(--wf-ink-2);font-size:11px}
.wf-sched-field__label{font-weight:600;color:var(--wf-ink)}
.wf-sched-field__hint{font-size:9px;line-height:1.55;color:var(--wf-ink-2)}
.wf-sched-field select,.wf-sched-field input{border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0;font:inherit;font-size:12px}
.wf-sched-field select:focus,.wf-sched-field input:focus{border-color:var(--wf-brand)}
.wf-sched-group{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--wf-border);border-radius:11px;background:var(--wf-layer-2)}
.wf-sched-group h5{margin:0;font-size:12px;color:var(--wf-ink)}
.wf-sched-radios{display:flex;flex-direction:column;gap:6px}
.wf-sched-radio{display:flex;align-items:center;gap:7px;color:var(--wf-ink);font-size:11px;cursor:pointer}
.wf-sched-radio input{accent-color:var(--wf-brand)}
.wf-sched-workspace{margin-top:6px;font-variant-numeric:tabular-nums}
.wf-sched-dates{display:flex;gap:7px}
.wf-sched-dates input{flex:1;font-variant-numeric:tabular-nums}
.wf-sched-dates .wf-btn{font-size:12px;padding:5px 10px}
.wf-sched-days{display:flex;gap:4px;flex-wrap:wrap}
.wf-sched-day{border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer);color:var(--wf-ink-2);padding:5px 0;width:32px;font-size:11px;cursor:pointer;font-weight:600}
.wf-sched-day:hover{border-color:var(--wf-brand);color:var(--wf-ink)}
.wf-sched-day.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 12%,var(--wf-layer));color:var(--wf-brand)}
.wf-sched-days .is-all{width:auto;padding:5px 10px}
.wf-sched-ranges{display:flex;flex-direction:column;gap:6px}
.wf-sched-ranges .wf-btn.is-ghost{align-self:flex-start;font-size:10px;padding:3px 8px}
.wf-sched-range-row{display:flex;align-items:center;gap:6px}
.wf-sched-range-row input{flex:1;min-width:0;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer);color:var(--wf-ink);padding:5px 7px;outline:0;font:inherit;font-size:12px;font-variant-numeric:tabular-nums}
.wf-sched-range-row input:focus{border-color:var(--wf-brand)}
.wf-sched-range-row .wf-btn{padding:3px 7px;font-size:11px}
.wf-sched-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.wf-sched-status-grid{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:10px;color:var(--wf-ink-2)}
.wf-sched-status-cell{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-sched-status-cell.is-error{color:var(--wf-err);white-space:normal;width:100%}
.wf-sched-dot{width:8px;height:8px;border-radius:50%;background:var(--wf-ink-2);flex:none;display:inline-block}
.wf-sched-dot.is-running{background:var(--wf-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-ok) 16%,transparent)}
.wf-sched-dot.is-waiting{background:#e6b23c}
.wf-sched-dot.is-paused{background:var(--wf-ink-2)}
.wf-sched-dot.is-error{background:var(--wf-err)}
.wf-sched-list-meta{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:9px;color:var(--wf-ink-2)}
.wf-sched-enabled{flex:none;display:flex;align-items:center;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border);color:var(--wf-ink);font-size:11px}
.wf-sched-enabled input{accent-color:var(--wf-brand)}
/* ---- 双月日历（样式参考用户日历素材） ---- */
.wf-cal-card{display:grid;gap:8px;padding:10px;border:1px solid var(--wf-border-strong);border-radius:12px;background:var(--wf-layer);box-shadow:0 14px 40px color-mix(in srgb,var(--wf-ink) 16%,transparent)}
.wf-cal-card__foot{display:flex;justify-content:flex-end}
.wf-cal-card__foot .wf-btn{font-size:11px;padding:5px 14px}
.wf-cal{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px;border-radius:12px;background:color-mix(in srgb,var(--wf-bg) 78%,transparent)}
.wf-cal-month{display:grid;gap:6px;min-width:0}
.wf-cal-month__head{display:grid;grid-template-columns:26px 1fr 26px;align-items:center;gap:4px;color:var(--wf-ink)}
.wf-cal-month__title{font-size:13px;font-weight:650;text-align:center;white-space:nowrap}
.wf-cal-nav{border:0;background:transparent;color:var(--wf-ink-2);font-size:15px;line-height:1;padding:4px;cursor:pointer;border-radius:6px}
.wf-cal-nav:hover{color:var(--wf-ink);background:var(--wf-layer-2)}
.wf-cal-nav.is-placeholder{visibility:hidden}
.wf-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.wf-cal-week{font-size:11px;font-weight:650;color:var(--wf-ink);text-align:center;padding:2px 0}
.wf-cal-cell{border:0;background:transparent;color:var(--wf-ink-2);font-size:12px;font-variant-numeric:tabular-nums;height:36px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;position:relative;cursor:pointer;padding:0}
.wf-cal-cell:disabled{cursor:default}
.wf-cal-cell.is-dim{color:var(--wf-ink-3,#6b7075)}
.wf-cal-cell:not(:disabled):hover .wf-cal-cell__num{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--wf-brand) 55%,transparent)}
.wf-cal-cell__num{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;position:relative;z-index:1;font-size:12px}
.wf-cal-cell.is-start .wf-cal-cell__num,.wf-cal-cell.is-end .wf-cal-cell__num{background:var(--wf-brand);color:#ffffff}
.wf-cal-cell__tag{font-size:7px;line-height:1;color:var(--wf-ink-2)}
.wf-cal-cell.is-start .wf-cal-cell__tag,.wf-cal-cell.is-end .wf-cal-cell__tag{color:var(--wf-brand);font-weight:650}
.wf-cal-cell.is-today .wf-cal-cell__num{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--wf-ink) 55%,transparent)}
/* ---- 自定义时间输入（文本按位 + 双列滑轮，两次点击确认） ---- */
.wf-time{display:inline-flex;align-items:center;gap:6px;position:relative;flex:1;min-width:0}
.wf-time__field{flex:1;min-width:0;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer);color:var(--wf-ink);padding:5px 7px;outline:0;font:inherit;font-size:12px;font-variant-numeric:tabular-nums}
.wf-time__field:focus{border-color:var(--wf-brand)}
.wf-time__clock{border:1px solid var(--wf-border);background:var(--wf-layer);color:var(--wf-ink-2);border-radius:7px;padding:5px 7px;cursor:pointer;font-size:11px}
.wf-time__clock:hover{border-color:var(--wf-brand);color:var(--wf-ink)}
.wf-time__picker{position:absolute;top:100%;left:0;z-index:60;display:flex;gap:2px;margin-top:4px;padding:6px;border:1px solid var(--wf-border-strong);border-radius:10px;background:var(--wf-layer);box-shadow:0 14px 38px color-mix(in srgb,var(--wf-ink) 16%,transparent)}
.wf-time__col{display:flex;flex-direction:column;gap:2px;max-height:188px;overflow:auto;scrollbar-width:thin;min-width:46px}
.wf-time__opt{border:0;background:transparent;color:var(--wf-ink-2);font-size:12px;font-variant-numeric:tabular-nums;padding:5px 8px;border-radius:7px;cursor:pointer}
.wf-time__opt:hover{background:var(--wf-layer-2);color:var(--wf-ink)}
.wf-time__opt.is-active{background:var(--wf-brand);color:#ffffff;font-weight:650}
`;
		//#endregion
		//#region \0dsh-global-css:D:\AiCoding-Gzx\HarnessPlugin\dsh-visual-workflow\src\client\entry.css.mjs
		const css = "";
		const tagId = "dsh-visual-workflow/entry.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-visual-workflow";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/entry.ts
		/** i18n 命名空间（注册进官方 locale 服务）。 */
		const I18N_NS = "visualWorkflow";
		/**
		* 会话树根 id 解析（疑点二修复）：DSH 中每个子代理对话持有独立 childSessionId
		* （官方 dsh-subagent：childId = SessionId(randomUUID())，header.parentSession 记录
		* 父链），若工作台直接绑定「当前选中会话」，在子代理对话界面打开时列表按子代理
		* 会话过滤为空，实例被误认为「跟随代理 ID」。实例/服务按**会话树根**隔离：
		* 沿官方 sessions.list summaries 的 parentSessionId 上溯到无父（根）会话，
		* 主代理与其全部后代子代理共享同一实例列表。快照无该字段（旧运行时）时回退
		* 当前会话自身（行为不变，单代理场景无回归）。
		*/
		function rootSessionIdOf(current, sessions) {
			if (!current) return "";
			const snapshot = sessions?.list?.getSnapshot?.() ?? sessions?.list?.get?.();
			if (!snapshot?.byId) return current;
			let cursor = current;
			const seen = /* @__PURE__ */ new Set();
			while (cursor && !seen.has(cursor)) {
				seen.add(cursor);
				const entry = snapshot.byId[cursor];
				const rawParent = entry?.parentId ?? entry?.parentSessionId;
				const parent = typeof rawParent === "string" ? rawParent : "";
				if (!parent || !snapshot.byId[parent]) return cursor;
				cursor = parent;
			}
			return cursor;
		}
		const inject = ["locale"];
		/** 测试导出（client-smoke 渲染路径验证）。 */
		const VisualWorkflowView = null;
		const __test = { FloatingWindow };
		function apply(ctx) {
			ctx.effect?.(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "visual-workflow";
				tag.textContent = styles;
				document.head.append(tag);
				return () => {
					tag.remove();
				};
			}, "visual-workflow: styles");
			const localeService = ctx.get?.("locale");
			try {
				localeService?.register?.(I18N_NS, {
					zh,
					en
				});
			} catch {}
			let root = null;
			let container = null;
			ctx.effect?.(() => {
				container = document.createElement("div");
				container.id = "visual-workflow-workbench-host";
				document.body.append(container);
				const localeService = ctx.get?.("locale");
				const render = () => {
					const t = text(detectLanguage(ctx.get?.("locale")));
					root ??= (0, react_dom_client.createRoot)(container);
					root.render(react.default.createElement(WorkbenchHost, {
						ctx,
						t
					}));
				};
				render();
				const unsubscribe = typeof localeService?.subscribe === "function" ? localeService.subscribe(render) : void 0;
				return () => {
					unsubscribe?.();
					root?.unmount();
					root = null;
					container?.remove();
					container = null;
				};
			}, "visual-workflow: workbench host");
		}
		//#endregion
		exports.I18N_NS = I18N_NS;
		exports.VisualWorkflowView = VisualWorkflowView;
		exports.__test = __test;
		exports.apply = apply;
		exports.inject = inject;
		exports.rootSessionIdOf = rootSessionIdOf;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map