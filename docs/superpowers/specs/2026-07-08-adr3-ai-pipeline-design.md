# ADR-3:AI 生成管线(设计)

*状态:**已实现**(2026-07-09,commits 0a4cfa1/c7d1130/61336d4/0c54f13——lint+接地+试运行+修复环、ai_drafts 溯源表+回执、D7 ghost-diff 逐元素接受、金例评测门+Batch CLI;真实 Anthropic 供应商联调与金例 Batch 首跑待 API key)· 设计定稿 2026-07-08*

产品定位(用户决策 2026-07-07):AI 辅助 ETA/FTA 自动生成是旗舰能力——现代世界级 PSA
工具的组成部分。对安全工具,信条固定为:**AI 起草,人来定,全程可溯**——恰好也是监管要求。

## 一、现状(backend/ai_draft.py + AiDraftPanel)

已有可敬的骨架:provider 抽象(cloud/local/example)、"AI 草案,待人工审核"提示词强制、
traceability/assumptions/questions/warnings 字段、AiDraftValidation、离线 fixture、契约测试。
三处结构性不足:①一次性 chat/completions,**无参考库接地**(current_project 之外无工具);
②目标形状是前端 v2 形状(EventTreeModel/ModelJson);③无评测,提示词/模型改动无门。
另:cloud 路径发送 `temperature:0.2` + `response_format:json_object`——Anthropic 原生路径
不得复制此形(现代模型拒绝 temperature;结构化输出走 output_config/strict tools)。

## 二、设计

### 2.1 输出目标 = 规范模式片段(依 ADR-1)

`DraftProposal { event_trees: EventTree[], fault_trees: FaultTree[], parameters: Parameter[],
assumptions[], questions[], traceability[], warnings[] }`——实体一律 canonical 形,溯源块
强制 `origin:'ai-draft'`、`grade:'D'`;JSON Schema 严格(additionalProperties:false),
直接引用 `GET /api/schema/project-document/1.0` 的子模式。**永不生成 v2 形状**(绞杀者:
旧 AiDraftPanel 路径在 ghost-diff 落地前经转换器兼容)。

### 2.2 接地(生成即引用,不再裸想)

Anthropic 原生 **tool-use 循环**(SDK tool runner),工具面:
- `search_reference_library(query, kind: component|barrier|ie)` → 条目(uuid/值/单位/grade/citation)
- `get_scenario_template(ie_type)` → 5 内置场景 + 迁移后的模板库
- `search_domain_corpus(query)` → 静态语料:bess-tr-model references + compass 调研报告
**硬规则(校验器强制,非仅提示词)**:每个数值参数须 cite 库条目 uuid(溯源块 source 带回
citation 快照)**或**显式 `ungrounded:true` + questions 里给出所需数据——无第三态。
幻觉失效率在结构上无法静默入模。

### 2.3 校验/修复环(确定性代码把关,模型只负责修)

```
生成 → ①JSON Schema 严格校验
     → ②领域 lint(backend/canonical/lint.py,同时服务手工编辑与 AI):
        Σ分支概率=1、feId 有序不变式、单位口径、PFD∈(0,1]、后果级合法、接地规则
     → ③引擎 dry-run(quantify:序列频率和≈IE 频率、无 NaN/负值)
     → 违规项结构化回喂修复,至多 3 轮;仍败 → 草案带 errors 原样返回(不静默丢弃)
```

### 2.4 评审与入模(D7 = ghost-diff 逐元素)

- 草案以 **ghost 节点/条目**叠画在画布(ETA 列/FTA 树/参数表),逐元素 接受/拒绝;
  「全部接受」仅是逐元素接受的批量快捷,审计仍逐实体记录。
- 接受动作:写入 canonical(溯源块补 `model_id/prompt_version/draft_id`)+ audit
  `ai_draft.accept(entity_uuid)`;拒绝同样审计。未处理完的草案可挂起恢复。
- AiDraftPanel 改造为 ghost 模式属 Phase 4b UI 工作(design-directions 出方向稿)。

### 2.5 记录与钉扎(依 ADR-2)

`ai_drafts` 表:`(id, project_uuid, baseline_version_id, request_json, response_json,
model_id, prompt_version, served_by, tool_trace_json, status: proposed|partially_accepted|
rejected|expired, created_at)`。发起草案前 dirty → 先 auto_pin 基线版本。**served_by 必记**
(server-side fallback 可能换模;读 usage.iterations)。审计可回答:"这个数是谁、用哪个
模型、基于哪个版本、引了哪条库据生成的"。

### 2.6 模型层(引 ai-model-strategy.md,此处只定接口)

默认 Anthropic 原生:草案 = claude-fable-5(effort high,`fallbacks:[opus-4.8]` 默认开);
解释面 = sonnet;微任务 = haiku。`PSA_LLM_PROVIDER=local|openai-compat` 路径保留
(受监管本地部署),同一 schema/校验/评测轨道兜底质量差异。提示词与库语料为缓存前缀
(排序键、1h TTL)。模型/提示词版本入 `prompt_version` 常量,升级必过评测门(§2.7)。

### 2.7 评测门(金例,先于规模化)

- `tests/ai_eval/`:金例 = 现有 coolant-leak 契约例 + 5 内置场景(held-out:给 goal 与
  IE 描述,比对结构);
- 评分维:结构匹配(屏障集/树形 F1)、接地率(cited/total)、lint 一次通过率、
  引擎 sanity 通过率;
- 运行:Batch API(50% 价),**手动/nightly CI job**(需 key,不阻默认 CI);基线分记
  `docs/benchmark/ai-eval-<date>.md`;**换模型或改提示词,评测分不得回退**——这是升级门。

## 三、非目标

对话式建模助手(草案管线之后的自然延伸)、报告文字生成(另一 surface,走 sonnet)、
自动接受任何元素、用 LLM 判数值正确性(那是引擎和 lint 的事)。

## 四、验收标准

1. 金例 6 例全部通过基线分;评测报告入库。
2. `ungrounded` 数值在校验器下无法进入 accepted 状态(测试断言)。
3. 接受实体在 canonical 中溯源块完整(origin/model_id/prompt_version/draft_id/citation 快照)。
4. ai_drafts + audit 联查可完整重放一次草案的生成与裁决史。
5. 现有 example-provider 契约测试继续绿(离线开发路径不破)。

## 决策记录

- **D7 接受粒度 → A ghost-diff 逐元素**(2026-07-08,用户选定):评审纪律与证据链最强,
  逐实体审计;「AI 草案,待人工审核」有了操作性定义。**排除**:B 按树/节(隐式评审,
  严评审会追问)、C 整体应用+清单(评审严谨性活在文档而非交互里)。
- **D8 模型/提供方 → 沿用 docs/design/ai-model-strategy.md**(既定):Fable 起草 +
  fallback Opus4.8、本地路径保留、Batch 评测、served_by 落库。
