# 前端系统性审查(P1–P4)— 2026-07-19

**背景**:2026-07-17/18 真实使用连续暴露三类前端缺陷(白屏、丢改动、量化 500),全部
单元测试测不出。用户裁决:不回滚(病根全部早于前后端改造,回滚不除雷且失去已验证
成果),改做系统性审查。本文是该审查的执行台账。

## 方法

| 阶段 | 内容 | 执行 |
|---|---|---|
| P1 | 五类病根模式扫描(机械 grep → 逐命中判定) | Fable 亲做 |
| P2 | 状态层逐 setter 冷读(projectStore/persistence/useModel) | Fable 亲做(禁独改区) |
| P3 | 端到端真机走查(建→编→撤→存→刷→重编/同拍连击/断后端) | Fable 亲做 |
| P4 | 8 页面四清单冷读(数据入/写出/错误面/特殊态) | Opus×3 只读并行,报回裁决 |

**五类病根**(源自当周实弹):① 值式覆写丢改动(渲染期旧快照算新模型整体覆写,
同拍后写冲前写);② 无守卫查找崩溃(getFt 回退/`.find()` 直接解引用);③ 边界缺失
白屏;④ 载荷解析硬取键;⑤ 竞态(无键守卫/目标悬空)。

## 结果总账

- **P1**:45 处值式写全部函数式化(FT 22 + ETA/后果/FMEA/App 23);8 个 FT mutator
  严格化(缺树 = no-op,绝不经 getFt 回退**误写别的树**、空树不抛);边界覆盖核验
  (7 懒页签 + 2 模态 + App 根);导入链三层校验确认;后端两转换点 400 映射确认。
- **P2**:store 全 setter 冷读——身份/派生写槽定向(R2-审)、open/switch/close 去重
  打包、Updater 通道健全;发现项(setFmea 非函数式、冲突对话无 catch)并入 P4 批修复。
- **P3**:同拍三连加节点 2→5 全落;连撤穿越挂载 → 防御对话框(非白屏)→ 菜单重做可恢复;
  保存/刷新/重编闭环一致;**断后端量化 → 可见"失败:… → 500"**,后端恢复重试即成功。
- **P4**:三代理报回 30 条 → 9 条已被 P1 覆盖、2 条按建议留观、4 条(P4-B)+ 11 条
  (P4-A/C)= **15 条采纳修复**。

## P4 采纳清单(按严重度)

1. **delConsequence 静默降级 C1**(领域级):删除被引用的自定义后果时引用叶静默跌到
   最轻级——安全工具不允许静默下调风险。改为拒删 + 可见理由(`branchesUsingConsequence`)。
2. 冲突对话「覆盖/另存副本」无 try/catch:二次 401/网络错时窗滞留或**谎报已存**。
   包裹 + 另存失败重现冲突条。
3. FMEA 全链值式写(persist/导入/重算/加行 6 处)→ 函数式;`setFmea` 收 Updater。
4. onAddBarrier 三步复合旧快照起算(双击丢屏障)→ 单一函数式 updater。
5. 量化/重要度守卫不作废在途(切 ETA 晚响应落错树)→ 失效 effect 内 begin();
   EventTreeEditor 按 `key={activeKey}` 重挂(选中/结果不跨树残留)。
6. App 根边界未罩 loading/LoginWall 分支 → AppGate 包裹三分支。
7. restoreSessionDraft 畸形草稿抛错按钮静默 → try/catch + 保留草稿。
8. FtaWorkbench Palette/LibPicker 未随 cvTreeExists 门控;standalone 编辑目标切项目
   悬空 → 门控 + 重置 effect。
9. 示例接口失败被吞成永久「加载中」→ loadError 可见。
10. CCF 组 id 按长度生成撞号(删中间再加 → 按 id 删一次删两组)→ 最大序号+1。
11. ReportDossier:409 后刷新台账同步状态机、403 显式文案、导出容忍无 model_data。
12. PortfolioTab:401 引导重登、latest_case.risk 解引用守卫。
13. 导入空 tabs 文件给可见提示;scenarioLoader 缺 labels/fe_prob 容错。

**留观 2 条**(P4-B 判定安全,弹层遮罩挡并发):参考库贝叶斯整行快照回写、探测三控件
整行写。列入 backlog,如做改逐字段函数式 upsert。

## 提交

`fdb…`(P1)与 `…`(P4 批)两条 commit(见 git log 2026-07-19),连同前日
4e41f1e/3e8c23d/8fccfe9/4297beb 构成本轮报障-审查闭环。基线:fe 455/455 · tsc 0 err ·
lint 231 持平 · py 618+24 benchmark(后端侧本轮未动数值语义)。

## 遗留(不阻塞,进 backlog)

- 参考库两处整行快照写(留观);ReportDossier 导出 401 引导重登(可留);
- `getFt` 显示路径回退语义(mutator 已严格化;显示侧改 undefined 需另评估波及);
- 自定义 ESLint 规则 `no-stale-model-set`(把值式写从机制上禁掉)——建议下一批;
- 模态内撤销限定树内编辑(UX 改进,用户点名可做)。
