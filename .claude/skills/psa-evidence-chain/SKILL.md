---
name: psa-evidence-chain
description: 证据链子系统(版本库/审计/分析案例/评审签发/认证/多项目组合总览)的实现与维护技能。修改 backend/store.py、backend/auth/*、canonical 层、评审状态机、导出门、/api/portfolio、报告页台账 UI,或任何"谁在何时批准了哪个版本"语义时使用。触发词:版本库、审计、analysis_cases、评审、签发、送审、退回、reviews、409、乐观并发、base_version_hash、认证、登录、角色、argon2id、会话、组合总览、portfolio、钉扎、auto-pin、导出门、工作稿、证据链、溯源。
---

# 证据链子系统(psa-evidence-chain)

这套子系统的产品定位:**"谁在何时批准了哪个版本"是数据库物理事实,不是流程约定**。
跨 backend(store.py / auth / app.py)与 frontend(ReportDossier / PortfolioTab /
persistence hook),不变量密度全仓最高——改任何一处先读本文。

## 一、真实架构(2026-07-14)

```
backend/store.py      SQLite 单文件(WAL)8 表:projects / versions / audit_log /
                      analysis_cases / ai_drafts / reviews / review_comments / accounts+sessions
backend/canonical/    严格 Pydantic 规范文档 + uuid5 确定性身份 + content_hash(SHA-256,
                      键排序紧凑 JSON 剥易变字段)+ v2 载荷无损互转(绞杀者 sidecar)
backend/auth/         mode(off|local)/ passwords(argon2id)/ provider / routes / guards / CLI
backend/app.py        _pin_case(导出/不确定性 → 版本幂等 + 案例)· 评审端点 · /api/portfolio
frontend ReportDossier(台账签发式 UI)· PortfolioTab(组合总览)· useProjectPersistence(身份/409)
```

## 二、不变量(改动前逐条对照;每条都有锁测)

1. **保存即版本,同内容幂等**:`create_version` 内容哈希命中 → 返回既有行;并发同内容
   经 IntegrityError 兜底仍幂等(16 线程 Barrier 锁测——check-then-insert 竞态已修)。
2. **审计只增**:代码无改写路径 + DB `BEFORE UPDATE/DELETE` 触发器 RAISE(ABORT) 双保险;
   每行携带 `auth:off|local` 标记(OS 用户与认证账户在同一链里可区分)。
3. **评审状态机**:草稿(无行)→ in_review → signed(终态)| returned(理由必填)。
   已签发行触发器禁改禁删;部分唯一索引保证每项目至多一行在审;签发落
   **角色快照**(授权依据可从只增链重建,不依赖可变 accounts 表)。
4. **导出门 = 内容寻址幂等,没有"冻结"概念**:导出 auto-pin 命中已签发版本(同哈希)
   → 页脚签发行;任何编辑 = 新哈希 = 自动工作稿。想加"锁定/冻结"字段前先重读这条。
5. **乐观并发**:保存带 `base_version_hash`,不符 → 409 + 冲突对话(diff/另存/强制覆盖),
   绝不静默覆盖;强制覆盖是显式动作且不带 base。
6. **认证是部署开关**:`PSA_AUTH=off`(默认)单机离线**零摩擦零降级**——最高不变式;
   local 模式:argon2id(RFC 9106 默认)、会话令牌 **sha256 落库**(库泄露≠会话劫持)、
   12h TTL 过半滑动续期、未知用户等时垫片(枚举防御)、统一 401 文案;
   三角色 analyst/reviewer/admin 路由守卫(分析-评审职责分离);签发要求复核口令。
7. **组合总览绝不现算**:数字只取已钉扎案例 `results_json`(report 钉
   `{"consequences"}`,uncertainty 钉 `{"point","bands"}` —— **必须双读**,只读前者会把
   已量化显示成"未量化",反保守,曾是真缺陷 F1);无案例 = 「未量化」,不补零。
8. **组合总览的三个锚定语义**(domain-review 裁决,别"简化"回去):
   - `review_state` 锚**最新版本**(防旧签发冒充现状);
   - `open_review` 独立字段(在审行可能钉在旧版本——只按最新版过滤会"看不见还能签");
   - 案例版本 ≠ 当前版本 → 前端琥珀徽章「数字非当前版本」(不靠肉眼比对哈希)。
9. **矩阵口径单一来源**:落格/评级由后端 `report_export.risk_placement` 给定
   (复用 `_freq_band/_SEV_RANK/_risk_level`);前端只复算装饰背景,且前后端各有一张
   **25 格金表互锁**(单侧锁只防单侧漂移)。累计列名用公式「C3+C4+C5 /yr」,
   不用"≥III"(那是单项目页的 C4+C5 危险等级口径,近同形词跨页误读)。

## 三、已付学费的陷阱(第三次踩就不可原谅)

- **夹具必须镜像真实管线形状**:uncertainty 案例真实钉 `{"point","bands"}`,测试夹具
  伪造 `{"consequences"}` 曾遮蔽 F1;LOPA 模板造假同理。写夹具前先看真实写入点。
- **钩子层 await 之后写回"当时活动的槽" = 跨项目串染**(R2 对抗审查 9 项发现的共同根因)。
  异步身份写回一律 `setIdentityFor(发起槽)`;新异步流先 grep 这个模式。
- **同作者自测不构成安全网**:本子系统任何状态机/隔离/并发改动,收口必须走一次
  独立对抗审查(fresh-context agent 冷读 + 时序探针),verify-psa 有升级规则。

## 四、验证门

改 store/auth → `make test-py`(评审/认证/并发探针都在 tests/backend);改组合总览语义 →
后端 test_portfolio.py(16)+ 前端 portfolioMath.test.ts(金表)双侧;改台账/签发 UI →
浏览器实测状态徽章与签发流(勿在 dev 数据上真签发,除非演示档);规格:
`2026-07-12-phase5-review-signoff-spec.md` · `2026-07-12-phase5-auth-layer-spec.md` ·
`2026-07-13-explorer-redesign.md §4/§6`。
