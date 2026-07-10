# AI 管线上线联调 Runbook(4c3)

*2026-07-10 · ADR-3 管线已实现并离线验证(FakeClient 全绿,240 py 测试含金例);本文是**需真实
Anthropic API key** 的最后一步:真模型首跑 + 金例 Batch 首提。除本文两步外无代码待写。*

## 前置(已就绪,无需改动)

- 模型钉扎:`backend/ai_pipeline.py` — `DRAFT_MODEL=claude-fable-5`、
  `FALLBACK_MODELS=[claude-opus-4-8]`(服务端回退 beta `server-side-fallback-2026-06-01`)、
  `PROMPT_VERSION=2026-07-09-p1`。响应带 provenance(model_id/served_by/prompt_version/rounds/tool_trace)。
- 门控:`PSA_AI_ENABLED=1` 开草案端点;未设时 `is_enabled()=False`(已验)。
- 金例:6 例(`backend/ai_eval.py::load_cases`),Batch 请求已可离线构建(custom_id 携
  `PROMPT_VERSION`,model=`claude-fable-5`)。
- 离线验证覆盖:lint / 接地 / 引擎试运行 / ≤3 轮修复环 / ghost-diff / rubric —— 均在 240 py 测试内,
  经 FakeClient 注入,**无需 key**。

## 需 key 的环境变量

```bash
export ANTHROPIC_API_KEY=sk-ant-...           # 或 PSA_LLM_API_KEY
export PSA_AI_ENABLED=1
export PSA_LLM_PROVIDER=cloud                 # 走 AnthropicClient(默认)
# 可选:export PSA_ANTHROPIC_BASE_URL=...     # 自建网关/代理时
```

Fable 需 30 天保留(非 ZDR)——按 ai-model-strategy.md,组织策略须允许该保留档;若走 ZDR 组织,
草案会命中拒绝并由服务端回退 opus-4.8(served_by 会如实记录)。

## 步骤一:真模型草案首跑(交互式,验证接地+修复环+回退)

```bash
make backend                                  # :8000,带上面的 env
# 另一终端:
curl -s localhost:8000/api/ai/draft-model -H 'content-type: application/json' -d '{
  "goal":"电池舱液冷泄漏导致外短","target":"eta","current_project":{...当前项目载荷...},
  "active_eta_key":"..."}' | python -m json.tool
```

**验收点**:响应 `provenance.served_by` = `claude-fable-5`(若回退则为 `claude-opus-4-8`,须能解释原因)、
`prompt_version=2026-07-09-p1`、`rounds≤3`、`tool_trace` 含 `search_reference_library` 调用、
每个数值元素带 `library_ref` 或显式 `ungrounded` 标注、`validation.ok=true`。
落库:`ai_drafts` 表新增一行(model_id/served_by/prompt_version/tool_trace/validation),审计 `ai.draft`。
UI:ETA 页「AI 建模助手」生成 → ghost 幽灵清单逐元素接受(与离线一致)。

## 步骤二:金例 Batch 首提(评测门基线)

```bash
python -m backend.ai_eval submit              # → {"batch_id":"msgbatch_..."}
python -m backend.ai_eval status <batch_id>   # 轮询至 ended
python -m backend.ai_eval fetch  <batch_id>   # 取回 → 逐例过 rubric → {"passed":bool,...}
```

**验收点**:`fetch` 输出 `passed=true`(6/6),各例 rubric(结构/可量化/接地声明/含糊必问)通过。
把该 batch 的 passed 结果 + `PROMPT_VERSION` 记为**基线**:此后换模型或改提示词,`fetch` 不得回退
(评测门语义)。exit code 非 0 即视为门失败,须查因(rubric 明细在输出 `results[]`)。

## 交付后

- 把首跑的 served_by 分布(fable 命中率 vs 回退率)与 Batch passed 结果追加到
  `docs/superpowers/ROADMAP.md` 的 4b 收口条目;若回退率异常高,查组织保留策略/beta 头。
- 真实供应商联调属**运营步骤**,不改代码;后续提示词迭代 → PROMPT_VERSION 递增 + 重跑 Batch。
