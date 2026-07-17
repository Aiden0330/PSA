# 规格:前端异步槽归属(WorkspaceAsyncOwnership)+ 分析上下文失效(AnalysisRunKey)

*2026-07-17 · Fable 5(前端评审 FE-02/FE-05,多项目隔离/并发禁独改类)· 实现同批(F-β)·
先例:R2-审 F1 的槽定向身份写入(projectStore.setIdentityFor 三路语义)*

## 1 · 病根

- **FE-02**:`P = useProjectStore.getState` 在 await 之后解析——异步回调写入**响应到达时**
  的活动槽。A 发起屏障量化 → 切 B → A 响应写进 B 的派生缓存 → 保存 B 时污染值经
  composeEta 入存档与证据链。R2-审只钉了身份写,派生写回(场景加载/初频/屏障 PFD/FTA
  派生)四路径全部未钉。
- **FE-05**:结果只随 `model` 引用失效;挂树/CCF/边界设置变化后旧结果继续显示;设置只按
  `activeKey` 重置,而不同项目常共享同一场景 key(A 的 house 覆盖带进 B);量化/重要度
  无请求代序,晚响应可覆盖新结果。

## 2 · 契约

**W(异步槽归属)**:
- W1 每个异步写回在 `await` **前**捕获发起 `wid = getState().workspaceId`(与目标 key)。
- W2 **派生缓存写**(pfds,撤销历史之外)走三路语义 `setEtaPfdFor(wid, key, feId, v)`:
  发起槽仍活动 → 顶层;已停放 → 写入该槽 pfds;已关闭 → 丢弃。绝不串槽。
- W3 **文档变更**(addTab 场景加载)只在发起槽仍活动时应用,否则**丢弃**(停放槽的撤销
  历史不被后台写触碰——比"写入停放槽"更强的保守选择,用户重点一次即可)。
- W4 同一(槽,目标)的乱序响应 last-write-wins:组件级 `staleGuard`(单调代序,begin →
  isCurrent),旧响应丢弃。适用:初频/屏障写回、FTA 派生、量化/重要度结果。

**R(分析上下文失效)**:
- R1 结果(engineSeq/engineMeta/imp)随 `[model, linked, etEngineOptions]` 任一变化立即
  清空——linked/etEngineOptions 由父组件 **useMemo 稳定化**(内联字面量 = 每渲染新引用 =
  失效风暴,契约写进 prop 注释)。
- R2 分析设置重置键 = **workspaceId + 目标身份**(ETA:wid+activeKey;FTA:wid+etaKey+
  树名+src)——同 key 跨项目不共享设置。
- R3 量化/重要度响应经 W4 代序守卫(晚 A 不覆盖新 B)。

## 3 · 锚点(vitest,先红)

| # | 断言 |
|---|---|
| W-1 | A 活动时发起,切到 B 后 `setEtaPfdFor(widA,…)` → B 顶层 pfds 逐位不变,A 停放槽 pfds 已更新 |
| W-2 | 槽已关闭 → 写被丢弃(任何槽都不变) |
| W-3 | 发起槽仍活动 → 顶层生效(旧行为零扰动) |
| W-4 | staleGuard:begin g1 → begin g2 → isCurrent(g1)=false、isCurrent(g2)=true |
| R-1 | EventTreeEditor 失效 effect 依赖含 linked 与 etEngineOptions(源码级锁:依赖数组断言) |
| R-2 | EtaWorkbench 设置重置依赖含 workspaceId(源码级锁) |

组件级 deferred-promise 端到端时序(评审"最低验收"全四路径)记 E2E 候选——本批以
store/守卫单元 + 源码级依赖锁落地,真浏览器对抗场景由 verify-psa 门的 DOM 演练覆盖。

## 4 · 范围外

保存/读档/冲突串行化(FE-04/08 = F-γ 批);证据链页 generation token(FE-06 = O-1,
按本契约 W4 同法则机械应用)。
