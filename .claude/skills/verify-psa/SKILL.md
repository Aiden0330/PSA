---
name: verify-psa
description: The standing verification gate before declaring any change done/committing — runs the right suites for what was touched and exercises the real UI. Use after implementing any feature/fix, before commit, or when the user says 验证/收口/verify. Non-negotiable for psaengine/bess numerical changes.
---

# Verify PSA

Green means verified, not "probably fine". Report numbers honestly — failures
verbatim, skips named.

## The gate, scaled to what changed

| Touched | Must run |
|---|---|
| Anything | `git diff --check` + the affected test suite |
| `frontend/src` | `make test-fe` + **`npx tsc -b`**(构建同款项目引用配置;`tsc --noEmit` 解析更宽松的 config,有漏过 4 错的前科——不要用) |
| `psaengine/` or `bess/` numerics | `make test-py` + **`make benchmark`** (no exceptions — the benchmark corpus is the regression gate) |
| `backend/` | `make test-py` (API tests live in tests/backend) |
| Reference data / anything embedded in the offline bundle | `make test-py` + `make bundle` (coordinator runs it; subagents never do) |
| Full pre-commit sweep | `make check` |

Baselines (2026-07-15): py **426 passed + 56 banked skips**(banked = tests/banked/
先红锚点,实现落地自动激活——skip 数下降而非转绿也是 finding)· benchmark 24/24
逐位 · vitest **320** pass. A *dropped* test count is a finding even when
everything passes.

## Beyond suites — exercise the territory

1. **UI changes: drive the real app.** Start preview (`.claude/launch.json`),
   verify with **DOM checks / JS assertions — screenshots time out on heavy
   pages** (established practice). Test the interaction, not the render.
   多项目相关改动必须做一次"双项目开切"冒烟(身份三元组随槽往返)。
2. **Numerical changes: one independent recomputation.** Recompute one
   sequence frequency by hand, or cross-check MOCUS vs BDD, or verify one
   importance direction. Engine agreeing with itself is not verification.
3. **Persistence changes: round-trip an OLD artifact** (payload v2 compat).
4. **Approximation changes: check the conservatism direction** — silently
   *underestimating* risk is the failure mode that matters.
5. **Fixtures must mirror the real pipeline.** 写测试夹具前先看真实写入点的
   形状(如 uncertainty 案例钉 `{"point","bands"}` 而非 `{"consequences"}`)——
   伪造形状的夹具曾两次遮蔽真缺陷(LOPA 模板、portfolio F1)。

## Escalation: when green is not enough

以下三类改动,套件全绿也**必须**追加一次独立对抗审查(fresh-context agent 冷读,
engine-reviewer / domain-reviewer / 通用对抗简报视对象选):

- psaengine/bess 数值语义(既有惯例,engine-reviewer);
- 监管面向的聚合/报告口径声明(domain-reviewer);
- **跨项目隔离 / 状态机 / 并发路径**(R2 教训:8 条同作者锁测全绿的隔离层,
  冷读探针 40 分钟判 FAIL——同作者自测结构上看不见 await 之后的串染)。

## Dev-environment false alarms(先排除再查代码)

- 白屏 + "Invalid hook call"(双 React)→ vite 依赖缓存损坏:网络里同名 chunk
  带/不带 `?v=` 各一份即确诊,`rm -rf frontend/node_modules/.vite` 重启。
- 控制台错误缓冲区跨重载累积——先看报错里的模块时间戳是否属于本次加载。

## Report format

What ran, exact counts vs baseline, what was exercised in preview (which
interactions), what was NOT verified and why. Then — and only then — commit
(one task per commit, English message, trailer = 实际执笔模型).
