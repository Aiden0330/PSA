# BESS PSA Web 前端 v1 (Phase 2) — Implementation Plan

**Goal:** 一个可运行、可演示的 SOTA Web PSA 工具垂直切片:FastAPI 后端包装 `psaengine`,React/TS 前端用 React Flow + Dagre 渲染标准 FTA 故障树,点"量化"调后端,ECharts 展示顶事件概率 / 割集 / 重要度。加载 BESS 领域算例。

**Architecture:** 单一 FastAPI 进程:`/api/*` 提供量化服务 + 托管前端构建产物 `frontend/dist`。前端开发期用 Vite dev server(CORS),交付期由后端静态托管。模型用 Phase 1 的 MEF 对齐 JSON;故障树→React Flow 节点/边由前端经 Dagre 布局。

**Tech Stack:** 后端 FastAPI + uvicorn + pytest(TestClient);前端 Vite + React 18 + TypeScript + React Flow(xyflow)+ dagre + echarts-for-react。

**Builds on:** Phase 1/1.5 引擎(`psaengine`, `bess`)。

---

## API 契约

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| GET | `/api/examples` | — | `[{id, name}]` 内置算例列表 |
| GET | `/api/model/{id}` | — | `{model: <MEF-JSON>, fault_tree: str}` |
| POST | `/api/quantify` | `{model, fault_tree, method, cutoff, limit_order}` | `{probability, method, cutsets:[{events,order,probability}], importance:{name:{fv,raw,birnbaum}}}` |
| POST | `/api/event-tree` | `{model, et_name}` | `{sequences:{}, consequences:{}}` |

模型 JSON 即 `psaengine.model.json_io` 的格式(可被 `Model` 直接消费)。

---

## File Structure

```
backend/
  __init__.py
  app.py            # FastAPI: API + 静态托管
  examples.py       # 内置算例(BESS BMS 故障树 + 热失控事件树)
  schemas.py        # pydantic 请求/响应模型
tests/backend/
  test_api.py       # TestClient 测 4 个端点
frontend/
  package.json, vite.config.ts, tsconfig.json, index.html
  src/main.tsx, src/App.tsx
  src/api.ts                 # fetch 封装
  src/layout.ts              # dagre 自动布局: model → {nodes, edges}
  src/components/FaultTreeCanvas.tsx    # React Flow + 自定义 FTA 节点
  src/components/nodes.tsx              # GateNode/BasicEventNode (FTA 符号 SVG)
  src/components/ResultsPanel.tsx       # 概率 + 割集表 + 重要度 ECharts
examples/
  bess_bms_ft.json   # BESS BMS 保护失效故障树(OR/2oo3/AND/basic 多级)
```

---

## Task A: 后端算例数据(BESS BMS 故障树)

**Files:** Create `examples/bess_bms_ft.json`

多级 FTA 算例(便于展示符号与割集):
```
TOP "BMS_PROTECTION_FAILURE" = OR(SENSOR_2OO3, CONTACTOR_AND, LOGIC_FAIL)
  SENSOR_2OO3 = ATLEAST 2/3 (V_SENSOR, T_SENSOR, I_SENSOR)
  CONTACTOR_AND = AND(MAIN_CONTACTOR, BACKUP_CONTACTOR)
  LOGIC_FAIL = basic
```
PFD 先验:V/T/I_SENSOR 0.02,MAIN/BACKUP_CONTACTOR 0.05,LOGIC_FAIL 0.01。

- [ ] **Step 1:** 写 `examples/bess_bms_ft.json`(MEF-JSON 格式:parameters + fault_trees[nodes])。
- [ ] **Step 2:** 验证可量化:`python -c "from psaengine import Model,Analysis; print(Analysis(Model.from_json('examples/bess_bms_ft.json')).probability())"` → 输出一个 0–1 概率。
- [ ] **Step 3:** 提交。

## Task B: FastAPI 后端 + 端点(TDD)

**Files:** Create `backend/{__init__,app,examples,schemas}.py`; Test `tests/backend/test_api.py`

- [ ] **Step 1: 写失败测试**(TestClient 测 /api/examples、/api/model/{id}、/api/quantify、/api/event-tree;断言 BMS 故障树 quantify 返回概率与 BDD 一致、含 cutsets/importance;BESS 事件树返回 C1–C5)。
- [ ] **Step 2:** 运行确认失败。
- [ ] **Step 3: 实现** `schemas.py`(pydantic)、`examples.py`(注册 bess_bms_ft + 热失控 ET 模型→JSON)、`app.py`(FastAPI,CORS,4 端点调用 `Analysis`/`quantify_event_tree`,`/` 与 `/assets` 静态托管 `frontend/dist`,dist 不存在时返回提示页)。
- [ ] **Step 4:** 运行确认通过(`pytest tests/backend -q`)。
- [ ] **Step 5:** 提交。

## Task C: 前端脚手架 + 依赖

**Files:** `frontend/`(Vite react-ts)

- [ ] **Step 1:** `npm create vite@latest frontend -- --template react-ts`;`cd frontend && npm install`。
- [ ] **Step 2:** `npm install reactflow dagre echarts echarts-for-react` 及 `npm install -D @types/dagre`。
- [ ] **Step 3:** `vite.config.ts` 设 `base: './'`(便于后端静态托管)+ dev proxy `/api → localhost:8000`。
- [ ] **Step 4:** `npm run build` 确认脚手架可构建。提交。

## Task D: 布局 + 自定义 FTA 节点

**Files:** `frontend/src/layout.ts`, `src/components/nodes.tsx`

- [ ] **Step 1:** `layout.ts`:输入模型 JSON 的某棵 fault_tree,产出 React Flow `nodes/edges`;用 dagre(rankdir TB)算坐标。节点 `type` 按 op 映射(and/or/atleast/basic/house)。
- [ ] **Step 2:** `nodes.tsx`:自定义节点组件,标准 FTA 符号——AND(平底拱形)、OR(曲底盾形)、ATLEAST(门内标 k/n)、基本事件(圆)、house(房子形);用内联 SVG;顶部/底部 Handle 连线。
- [ ] **Step 3:** 构建确认无类型错误(`npm run build`)。提交。

## Task E: 画布 + 结果面板 + 主应用

**Files:** `src/components/FaultTreeCanvas.tsx`, `src/components/ResultsPanel.tsx`, `src/api.ts`, `src/App.tsx`

- [ ] **Step 1:** `api.ts`:`getExamples/getModel/quantify/eventTree` fetch 封装。
- [ ] **Step 2:** `FaultTreeCanvas.tsx`:React Flow 渲染 layout 结果,注册 nodeTypes,minimap + controls + 背景。
- [ ] **Step 3:** `ResultsPanel.tsx`:显示顶事件概率(大数字)、割集表(事件/阶/概率/贡献%)、重要度龙卷风(echarts 横向条形)。
- [ ] **Step 4:** `App.tsx`:载入算例下拉 → 取模型 → 画布;"量化"按钮 → 调 /api/quantify → 结果面板;另一标签显示 BESS 事件树 C1–C5(调 /api/event-tree)。
- [ ] **Step 5:** `npm run build`。提交。

## Task F: 集成 + 运行验证

- [ ] **Step 1:** `npm run build` 产出 `frontend/dist`。
- [ ] **Step 2:** 起后端 `uvicorn backend.app:app --port 8000`(后台);后端静态托管 dist。
- [ ] **Step 3:** 用 Preview/浏览器工具打开 `http://localhost:8000`,截图确认:故障树以标准符号渲染、点"量化"后概率/割集/重要度出现、事件树标签显示 C1–C5。
- [ ] **Step 4:** 修任何渲染/接口问题至端到端通。提交 + 收尾。

---

## 验证策略
- 后端:pytest TestClient(quantify 概率对拍引擎 BDD 值)。
- 前端:`npm run build` 类型/构建门 + 运行期截图人工确认渲染与交互(前端无单测,靠端到端可视验证)。
- 端到端:单进程(FastAPI 托管 dist)`http://localhost:8000` 截图为准。
