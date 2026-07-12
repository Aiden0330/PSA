# Phase 5 · 评审/签发工作流实施规格(D-P5-5 = 方向 A 台账签发式)

*2026-07-12 · 状态:待实施(用户排期动工)· 决策来源:ADR-4
`2026-07-10-adr4-multiuser-design.md`(D-P5-5 用户选定方向 A,mockup 9769dc6)·
mockup 参照:`docs/design/mockups/2026-07-10-review-a-ledger.html`*

## 0 · 范围与非目标

**做**:报告页版本台账加签发状态(草稿/送审中/已签发/退回)+ 送审/签发/退回动作 +
版本级评论 + 签发确认弹窗 + 报告页脚签发行 + 正式导出门(未签发 → 工作稿标识)。

**不做(留缝)**:元素锚定评论线程(方向 B → `review_comments` 将来加可空 `anchor` 列)、
多项目看板(方向 C → 纯 reviews 只读视图)、四级会签栏(方向 D → reviews 将来加
`role_slot`)。均为增量迁移,本规格不预置字段(YAGNI;SQLite `ALTER TABLE ADD COLUMN` 廉价)。

**与认证解耦(约束 #0 关键)**:本工作流只依赖 `store.actor()`。
`PSA_AUTH=off`(默认)= 全流程可用,身份为 OS 用户 —— 单人顾问也要版本冻结与页脚签发行;
`PSA_AUTH=local` 落地后 actor 自动升级为会话身份、角色守卫与签发口令复核生效。
因此本特性可先于 auth 层实施与测试。

## 1 · 语义(状态机与不变量)

评审状态挂在 **(project_uuid, version_id)** 上;版本本身已内容寻址不可变(ADR-2),
"冻结"无需新机制 —— 见 §4 导出门的幂等论证。

```
(无 review 行) = 草稿
  ──送审──▶ in_review ──签发──▶ signed   (终态,不可撤销;取代 = 签发更新版本)
                 │
                 └──退回──▶ returned ──重新送审──▶ in_review(同一行,状态回转)
```

不变量(全部落测试):
- **signed 终态**:reviews 行一旦 `state='signed'` 不得再变 —— SQLite 触发器
  `RAISE(ABORT)`(复用 audit_log 只增触发器惯用法,`store.py:69-72`)。
- **单项目至多一个送审中**:部分唯一索引
  `CREATE UNIQUE INDEX ... ON reviews(project_uuid) WHERE state='in_review'`。
- **每次状态迁移追加审计**:`review.submit` / `review.sign` / `review.return`,
  details 含 `{version_id, content_hash, note}`;签发人身份即审计行 actor。
- 签发/退回仅允许从 `in_review`;送审仅允许草稿或 `returned`;已签发版本不可再送审。
- 退回必须带 note(422);送审/签发 note 可选。

## 2 · 存储层(`backend/store.py` 增量)

DDL 追加到 `_DDL`(idiom 同现有表):

```sql
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  state TEXT NOT NULL CHECK(state IN ('in_review','signed','returned')),
  submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, note TEXT,
  UNIQUE(project_uuid, version_id));
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_in_review
  ON reviews(project_uuid) WHERE state='in_review';
CREATE TABLE IF NOT EXISTS review_comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_uuid TEXT NOT NULL REFERENCES projects(uuid),
  version_id INTEGER NOT NULL REFERENCES versions(id),
  author TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS reviews_signed_final BEFORE UPDATE ON reviews
  WHEN OLD.state='signed'
  BEGIN SELECT RAISE(ABORT, 'signed review is final'); END;
```

函数(签名风格同 `create_version`/`record_audit`;全部走 `with _conn() as cx` +
`record_audit(cx, ...)` + `actor()`/`_now()`):

- `submit_review(puuid, version_id, note=None) -> dict` — 校验版本存在且属于该项目;
  草稿 → INSERT;returned → UPDATE 回 in_review(重置 submitted_by/at,清 decided_*);
  已 signed → `ValueError`;另有 in_review → `sqlite3.IntegrityError` 由 API 层转 409。
  审计 `review.submit`。
- `sign_review(puuid, version_id, note=None) -> dict` — 仅 in_review → signed,
  写 decided_by=actor()/decided_at;审计 `review.sign`。
- `return_review(puuid, version_id, note) -> dict` — 仅 in_review → returned,note 必填;
  审计 `review.return`。
- `list_reviews(puuid) -> list[dict]` — join versions 取 content_hash。
- `review_for_version(puuid, version_id) -> Optional[dict]` — 导出门/页脚查询点。
- `add_review_comment(puuid, version_id, body) -> int`(审计 `review.comment`)·
  `list_review_comments(puuid, version_id) -> list[dict]`。

## 3 · API(`backend/app.py`;JSON 一律 `application/json; charset=utf-8`)

| 方法 路径 | 体 | 语义 / 错误 |
|---|---|---|
| `GET /api/projects/{puuid}/reviews` | — | 全部评审状态(含 content_hash 短哈希用料) |
| `POST /api/projects/{puuid}/reviews` | `{version_id, note?}` | 送审;400 版本不存在/已签发,409 已有送审中 |
| `POST /api/projects/{puuid}/reviews/{version_id}/sign` | `{note?, password?}` | 签发;409 非送审中;`password` 仅 PSA_AUTH=local 时校验(off 忽略) |
| `POST /api/projects/{puuid}/reviews/{version_id}/return` | `{note}` | 退回;422 缺 note;409 非送审中 |
| `GET/POST /api/projects/{puuid}/versions/{version_id}/comments` | POST `{body}` | 版本级评论 |

角色守卫(auth 层落地后启用;`PSA_AUTH=off` 全放行):送审=分析员+,
签发/退回=评审人+,评论=任何已认证用户。错误响应带中文 `detail`(前端 detail-aware)。

## 4 · 导出门与页脚(`backend/report_export.py`)

**门的机制 = 内容寻址幂等,零新增冻结机制**:导出时 auto-pin(ADR-2)对当前载荷取
content_hash —— 与已签发版本内容逐位一致 ⇒ `create_version` 幂等返回**同一 version_id**
⇒ `review_for_version` 命中 signed;有任何未保存改动 ⇒ 新 version_id ⇒ 无 review 行 ⇒
工作稿。签发状态天然只跟内容走,不可能"改了模型还带着签发章导出"。此论证必须落一条测试(§7)。

- `_evidence_line(ev)`(`report_export.py:86-89`)扩展:ev 增可选 `signoff`
  `{signer, signed_at}` →
  `…引擎 bess-psa {v} · {ts} · 签发 {signer} {signed_at[:10]}`;
  无 signoff → 追加 `· 工作稿(未经签发)`。
- docx/pdf:标题区下方加一行工作稿标识 `工作稿 — 未经签发`(签发版无此行);
  不做逐页对角水印(廉价、诚实、可测)。csv:未签发时首行注释 `# 工作稿 — 未经签发`。
- 装配点:app.py 报告导出路径在 auto-pin 后查 `review_for_version`,把 signoff 塞进
  evidence dict;`update_case_artifacts` 顺带在 artifacts_json 记 `signed: true|false`。

## 5 · 前端(方向 A:零新页面,全部住在 `ReportDossier.tsx`)

**保留每一个现有控件与处理器**:onExport 三按钮、refresh、版本对比 selects/onDiff、
台账排序、badge/th/td 样式常量。以下全为增量。

### 5.1 `frontend/src/api.ts`

```ts
export interface ReviewInfo { version_id: number; content_hash: string;
  state: 'in_review'|'signed'|'returned'; submitted_by: string; submitted_at: string;
  decided_by?: string; decided_at?: string; note?: string }
export interface ReviewComment { id: number; author: string; created_at: string; body: string }
listProjectReviews(puuid): Promise<ReviewInfo[]>
submitReview(puuid, versionId, note?): Promise<ReviewInfo>
signReview(puuid, versionId, note?, password?): Promise<ReviewInfo>
returnReview(puuid, versionId, note): Promise<ReviewInfo>
listVersionComments(puuid, versionId): Promise<ReviewComment[]>
addVersionComment(puuid, versionId, body): Promise<ReviewComment>
```

普通 `fetch` + detail-aware 错误(同 quantify 惯用法);**不进** `/api/saved` 的
localStorage 回退家族 —— 评审动作离线无意义,失败就显式报错。

### 5.2 `ReportDossier.tsx` 组成

- state 增 `reviews: ReviewInfo[]`、`comments: ReviewComment[]`、`signModal: number|null`
  (version_id);`refresh()` 并行加 `listProjectReviews`。
  `reviewByVersion = (vid) => reviews.find(r => r.version_id === vid)`。
- **版本台账行**(现 145-152 行结构)在 origin span 后插状态徽章(样式随 mockup A:
  `--psa-amber` 送审中 / ok 绿 已签发+签发人 / `--psa-danger` 退回+note 悬浮)——
  草稿不加徽章(降噪);行尾动作区:
  最新草稿/退回行 → `送审` 按钮(`psa-btn`);in_review 行 → `签发…`(`psa-btn psa-btn--primary`,
  打开确认弹窗)+ `退回…`(prompt 收 note);signed 行 → 悬浮 title 显示签发记录。
- **签发确认弹窗**(idiom 随 `BarrierFtModal`):正文 = 版本短哈希 + 完整哈希 title +
  「签发后不可撤销;身份/时间/哈希写入只增审计并进报告页脚」+ note 输入;
  `password` 输入框仅当 auth 模式为 local 时渲染(auth 层落地前恒隐藏);
  确认 → `signReview` → refresh。
- **分析案例台账**加「正式性」列:`reviewByVersion(c.version_id)?.state === 'signed'`
  → ok 徽章 `正式(签发版)`,否则 faint `工作稿` —— 纯前端 join,零后端改动。
- **版本评论**面板:版本对比块之下,select 选版本(默认 in_review 行,否则最新)+
  评论列表 + 输入行(`addVersionComment` 后重载)。
- 页头副标题句尾追加:`· 签发状态见台账`(可选,一行文案)。

### 5.3 收尾

ReportDossier 是懒加载 chunk → 改动影响离线包 ⇒ **`make bundle`**(硬约束 7)。

## 6 · 实施顺序(TDD,一任务一提交)

1. store 层:DDL + 迁移函数 + 触发器/索引 + 单测(§7 store 组)。
2. API 五端点 + 单测(状态码矩阵、charset、detail 文案)。
3. 导出门:evidence signoff 装配 + `_evidence_line` 扩展 + 工作稿标识 + 幂等门测试。
4. `api.ts` 函数 + vitest(mock fetch)。
5. `ReportDossier` UI(frontend-dev 可执行;本规格 §5.2 即组成说明)+ vitest。
6. `make bundle` + `make check`;ROADMAP 记录。

角色守卫与签发口令复核**不在**本序列 —— 属 auth 层(ADR-4 修复项 1-3 + accounts),
落地时按 §3 表补守卫测试。

## 7 · 验收测试清单

- **store**:送审→签发 happy path;签发终态(UPDATE 触发 ABORT,property);
  单项目双送审 IntegrityError;returned→重新送审同行回转且 decided_* 清空;
  每迁移一条审计(kind 断言);已签发版本再送审 ValueError;审计只增性质(既有 property)仍绿。
- **API**:409(双送审/非送审中签发)、400(幽灵版本)、422(退回缺 note)、
  签发响应含 decided_by;`charset=utf-8`。
- **导出门**(核心):签发版本原样导出 → 页脚含 `签发 <actor>` 且无工作稿行;
  改一个 PFD 再导出 → auto-pin 新版本 → 页脚含 `工作稿(未经签发)` + 标识行;
  csv 首行注释存在/不存在两分支。
- **前端**:徽章按 state 渲染;送审按钮触发 api 并刷新;案例正式性 join 正确;
  签发弹窗确认路径;评论增查。
- **回归**:`make check` 全绿;`PSA_AUTH` 未涉及 —— off 模式行为即全部行为(约束 #0)。
