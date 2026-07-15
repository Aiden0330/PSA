# 护栏完备性审计:每条硬约束的绊线在哪(2026-07-14,Fable 冷读)

目的:进入"无 Fable 级模型"的开发期之前,逐条回答 **"违反这条约束时,哪个测试会红?"**
——让低阶模型物理上无法静默破坏不变量。审计范围:CLAUDE.md 硬约束 ×7 + 三个域技能
的不变量清单。结论:补 2 把新锁后,**全部约束要么有失败测试绊线,要么显式标注为
过程/ADR 守护**(仅 2 项,见表尾)。

## CLAUDE.md 硬约束

| # | 约束 | 绊线 | 状态 |
|---|---|---|---|
| 1 | 版本钉扎 Vite5/React18/echarts5/ag-grid32 | `frontend/src/versionPins.test.ts`(**本次新增**:主版本逐一断言,动 package.json 先红) | ✅ |
| 2 | id/feId 语义、有序可跳分支、MEF/引擎请求形 | eventtree reorderFe/isCascade 守护、`test_event_tree_skip.py`、MEF round-trip、canonical 往返+哈希锁 | ✅ |
| 3 | 引擎改动 ⇒ benchmark | CI `engine-benchmarks` 阻断作业(24 例逐位)+ verify-psa 门 | ✅(CI+过程) |
| 4 | 数据出处:citation 强制、内置仅 C/D、单位纪律 | `test_library.py`:citation 非空、grade∈{C,D} ×3 分区、IE unit+推导链≥20 字、**component unit ∈ 既有口径集(本次新增,防静默发明新口径)** | ✅ |
| 5 | AI 溯源:强制 D 级、「待人工审核」、接地 | `test_ai_pipeline.py`(自评 A/B = 校验错误、marker 断言、library_ref/ungrounded 二选一 lint) | ✅ |
| 6 | JSON charset=utf-8 | `tests/backend/test_encoding_api.py`(专项)+ 多端点重复断言 | ✅ |
| 7 | 前端改动 ⇒ make bundle | **过程守护**:离线包新鲜度不可测试(产物 gitignored);CI 前端 build 保可编译,重建靠收口清单 | ⚠️ 过程 |

## 证据链子系统(psa-evidence-chain 九不变量)

保存幂等+并发竞态(Barrier 16 线程)`test_store/test_p3` ✅ · 审计只增(裸 SQL 篡改
断言)✅ · 评审状态机(签发终态触发器/单在审部分唯一索引)`test_reviews_store` ✅ ·
导出门=内容寻址幂等 `P5-3 idempotency` ✅ · 乐观并发 409 `test_saved_api` ✅ ·
auth off 零降级 `test_auth_mode` ✅ · 令牌 sha256 落库 `test_auth_store` ✅ ·
枚举等时垫片 `test_auth_guards` ✅ · portfolio 双读/最新版锚定/open_review
`test_portfolio`(16)✅ · 矩阵 25 格金表**前后端互锁** ✅。

## 引擎(psa-engine)

成功分支精确否定(0.109 锚)✅ · REA 不入交付(后处理与精确通道隔离断言)✅ ·
频率通道全套(一频率规则/非相干拒绝/量纲双向护栏/exact 模式 7 锚 + 300 例随机对拍)✅ ·
CCF 一致性恒等式性质测试 + 组规模>6 拒绝 ✅ · CUDD 对拍 1e-12 ✅ ·
**「无补边 ROBDD」为架构决定**:无直接绊线(行为由基准+性质测试覆盖),重新引入
须 ADR + 全量基准——**ADR 过程守护** ⚠️。

## 前端(psa-frontend)

多项目槽隔离 13 锁 + 槽钉定/键迁移 5 锁 ✅ · tsc -b = CI `npm run build` ✅ ·
版本钉扎(新增)✅ · 金表(portfolioMath)✅。

## 结论与移交

- 新增绊线 2:版本钉扎、器件失效率单位口径集。
- 非测试可执行仅 2 项(约束 7 离线包新鲜度、无补边架构决定),均已在本文与
  CLAUDE.md「后 Fable 运行规则」中显式标注为过程/ADR 守护。
- 本审计与 CI 四作业(py/benchmark/CUDD/前端)共同构成低阶模型时代的物理门;
  GitHub 远程建立后 CI 即时生效。
