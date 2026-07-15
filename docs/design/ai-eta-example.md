# AI ETA 自动生成示例契约

本示例定义 Codex/LLM 自动生成 ETA 草案时的最小输入与输出。首版目标不是直接产出工程结论，而是生成可审查、可校验、可被现有 ETA 引擎量化的建模草案。

## 示例文件

- 输入: `examples/ai_eta_coolant_leak_request.json`
- 输出: `examples/ai_eta_coolant_leak_response.json`
- 回归测试: `tests/backend/test_ai_eta_example_contract.py`

## 输入是什么

输入遵循后端 `POST /api/ai/draft-model` 的 `AiDraftRequest`:

```json
{
  "goal": "电池舱液冷泄漏导致外短",
  "target": "eta",
  "current_project": {
    "v": 2,
    "etas": [],
    "activeKey": "",
    "checkedKeys": {}
  },
  "active_eta_key": null,
  "user_context": {
    "mode": "new_eta",
    "instruction": "生成一个标准级联 ETA 草案...",
    "explicit_values": {
      "initFreq": {
        "value": 0.001,
        "unit": "per year",
        "source": "用户输入示例值"
      },
      "barriers": []
    }
  }
}
```

字段含义:

- `goal`: 用户的建模意图，应是可落到一个初因事件的自然语言描述。
- `target`: 生成目标；本示例固定为 `eta`。
- `current_project`: 当前项目快照，允许模型理解已有 ETA/FTA，但不得直接改写项目。
- `active_eta_key`: 当前活动 ETA；生成新 ETA 时可为 `null`。
- `user_context.mode`: 前端动作，本示例是 `new_eta`。
- `user_context.explicit_values`: 可使用的确定数值来源。模型不得凭空生成 `initFreq` 或 `failProb`。

## 输出是什么

输出遵循 `AiDraftResponse`:

- `draft_id`: 草案标识。
- `summary`: 草案摘要。
- `assumptions`: 建模假设。
- `questions`: 缺失数据或需要人工确认的问题。
- `etas`: 候选 ETA 页签数组。
- `fts`: 候选项目级 FTA；本示例为空。
- `traceability`: 每个数值或结构的来源。
- `warnings`: 风险提示。
- `validation`: 后端确定性校验结果。

核心 ETA 结构是前端 `EventTreeModel`:

```json
{
  "initEvent": "电池舱液冷泄漏导致外短",
  "initFreq": 0.001,
  "functionalEvents": [
    { "id": "B_LEAK_DETECT", "label": "液冷泄漏检测联锁", "failProb": 0.05 },
    { "id": "B_BMS_ISO", "label": "BMS 断开隔离", "failProb": 0.1 },
    { "id": "B_FUSE", "label": "熔断/保护开断", "failProb": 0.02 }
  ],
  "root": {
    "kind": "branch",
    "feId": "B_LEAK_DETECT"
  }
}
```

标准级联语义:

- 屏障成功进入较轻后果。
- 屏障失败进入下一屏障。
- 所有屏障失败进入最严重后果。
- 分支引用的 `feId` 必须存在，且沿路径顺序严格递增。

## 期望量化结果

示例使用 `initFreq = 0.001`，三个屏障 PFD 分别为 `0.05`、`0.1`、`0.02`。现有 ETA 引擎应得到:

| 序列 | 路径 | 年频率 |
| --- | --- | --- |
| `L0` | 泄漏检测成功 | `0.00095` |
| `L1` | 泄漏检测失败，BMS 隔离成功 | `0.000045` |
| `L2` | 检测和隔离失败，熔断/保护成功 | `0.0000049` |
| `L3` | 三个屏障均失败 | `0.0000001` |

这些数值只用于验证契约和端到端冒烟，不代表真实工程取值。

## 本地演示 Provider

后端内置一个只用于演示和回归测试的 `example` Provider。它不会调用外部模型，而是读取 `examples/ai_eta_coolant_leak_response.json`，再走同一套 `AiDraftResponse` 解析和确定性校验。

PowerShell 示例:

```powershell
$env:PSA_AI_ENABLED = "1"
$env:PSA_LLM_PROVIDER = "example"
```

随后启动后端和前端，在 ETA 页打开“AI 建模助手”，输入“电池舱液冷泄漏导致外短”并点击“生成草案”，即可看到该固定草案。应用草案仍需要用户手动点击“应用草案”。

## Codex 如何使用这个示例

可以把输入 JSON 作为 Codex/LLM 的用户消息，要求它只返回符合 `AiDraftResponse` 的 JSON。返回后必须经过:

1. 后端 `validate_draft` 确定性校验。
2. 前端人工审查面板展示。
3. 用户点击“应用草案”。
4. 现有 ETA/FTA 引擎量化。

校验失败时，草案只能展示，不能应用到项目。
