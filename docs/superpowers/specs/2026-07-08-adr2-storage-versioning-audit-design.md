# ADR-2:存储/版本化/审计(设计)

*状态:已定向草案 — D5/D6 经访谈选定;依赖 ADR-1(规范模式与 content_hash) · 2026-07-08*

监管前提(用户决策 2026-07-07):报告将面对要求证据链的评审。本 ADR 落实链条中
「报告数字 → 分析案例 → 模型版本 → 数据条目」的**存储侧三环**;数据条目侧已由参考库
+ADR-1 溯源块覆盖。数据出处评审(docs/reviews/2026-07-08)证实:没有版本与分析案例
绑定,任何数字都无法回答"出自哪个模型、什么设置"。

## 一、现状

`backend/storage.py`:`saved/*.json` 可变覆写 blob(id=hex8,{id,name,saved_at,payload});
localStorage 工作态自动存;`.psaproj.json` 导出文件。**无历史、无审计、无分析记录**;
报告导出即算即走,不留痕。

## 二、设计(依 D5=单文件 SQLite、D6=保存即版本+分析自动钉扎)

### 2.1 存储引擎

`data/projects.db`(gitignore),**标准库 sqlite3,零新依赖**(与引擎纯 Python 哲学一致),
WAL 模式。多用户期(Phase 5)机械迁移 Postgres——schema 即按此设计,不用 ORM 魔法。

```sql
projects(uuid TEXT PK, name, created_at, modified_at, meta_json)
versions(id INTEGER PK, project_uuid REF, content_hash TEXT, parent_version_id,
         canonical_json TEXT,           -- ADR-1 §6.6 规范序列化全文
         created_at, actor, origin TEXT,        -- 'save' | 'auto_pin' | 'import'
         message TEXT, UNIQUE(project_uuid, content_hash))
audit_log(id INTEGER PK, ts, actor, action TEXT, project_uuid,
          version_id NULL, entity_uuid NULL, details_json)   -- 追加式
analysis_cases(id INTEGER PK, project_uuid REF, version_id REF NOT NULL,
               kind TEXT,               -- quantify|uncertainty|importance|report|ai_draft(ADR-3)
               engine_version, settings_json,   -- method/cutoff/samples/seed/error_factor…
               results_json, artifacts_json,    -- 报告文件哈希/文件名等
               created_at, actor)
```

- **audit_log 只增**:应用层无 UPDATE/DELETE 路径,另加 SQLite 触发器 `RAISE(ABORT)`
  双保险;属性测试断言任何改写被拒。
- actor:单用户期 = OS 用户名 + 应用版本(字段即为 Phase 5 的 user id 留位)。

### 2.2 版本语义(D6)

- 显式保存(保存项目/存档)→ `create_version`;**同 content_hash 幂等**返回既有版本
  (无重复)。parent 链成历史;message 可选。
- **分析自动钉扎**:一切"为记录而算"的动作——不确定性运行、报告导出、(ADR-3)AI 草案
  基线——若工作副本 dirty,先自动建版本(origin='auto_pin',audit 记 `version.auto_pin`),
  再建 analysis_case 绑定该 version_id。**任何可报告数字都钉在版本哈希上,无例外。**
- 会话内撤销/重做维持 useHistory,不入库。

### 2.3 审计事件分类(初版)

`project.create|rename|delete` · `version.create|auto_pin` · `analysis.run(kind)` ·
`report.export(format→case_id)` · `import.legacy|mef` · `ai_draft.request|accept|reject`
(ADR-3,entity 粒度)。**边界**:前端画布编辑不逐笔上报——编辑聚合体现为版本间 diff
(可由两版本 canonical_json 计算);服务端动作全审计。

### 2.4 绞杀者路径

- 旧 `/api/saved` 端点保留(UI 不改):写路径内部 v2→canonical→create_version;读路径
  从最新版本转回 v2。`saved/*.json` 一次性导入脚本(每档→1 项目 1 版本,origin='import');
  导完旧目录归档不删。
- `.psaproj` 便携文件 = **单版本快照**(信封 v3 含 canonical document);完整历史属 db。
  「导出含历史」为后续可选项,非本期。
- 新端点(草案):`GET/POST /api/projects`,`GET /api/projects/{uuid}/versions`,
  `GET /api/projects/{uuid}/versions/{id}`(含 diff=?other),`GET /api/projects/{uuid}/audit`,
  `GET/POST /api/projects/{uuid}/cases`。Model Compare(parity #5)即两版本 canonical diff。

### 2.5 证据链落点(对照技能 regulatory-traceability)

| 链环 | 落点 |
|---|---|
| 报告数字 → 分析案例 | 报告导出必产 analysis_case(kind='report'),报告页脚记 case id + version hash 短址 + engine_version |
| 案例 → 模型版本 | cases.version_id NOT NULL;auto_pin 保证 dirty 态不可达 |
| 版本 → 数据条目 | canonical 溯源块(ADR-1 §6.3):引用时快照 citation/grade/unit |
| AI 内容 | ADR-3:ai_drafts 记录 + 实体级 accept 审计 |

## 三、非目标

云同步/端到端加密/多用户锁与合并(Phase 5)、报告文件本体入库(存哈希与路径)、
参考库内置层版本化(走 git)。

## 四、验收标准

1. 属性测试:audit_log 改写被拒;同哈希重复保存幂等;auto_pin 后导报告 →
   `case.version.content_hash == hash(当前文档)` 恒成立。
2. 导入脚本迁移现有 `saved/` 全部成功且逐字段 round-trip(经 v2↔canonical)。
3. 旧 `/api/saved` 行为不变(现有 backend 测试 156 项全绿),新增表/端点测试覆盖。
4. 报告(docx/pdf/csv)页脚含 case id + 版本短哈希 + 引擎版本(报告测试断言)。

## 决策记录

- **D5 存储引擎 → A 单文件 SQLite**(2026-07-08,用户选定):stdlib sqlite3 零新依赖、
  事务性、单文件备份、可查询(diff/审计/案例)、机械迁移 Postgres。**排除**:B git 式
  内容寻址文件(事务与并发弱,审计仍需索引库,终成杂交)、C blob+边车目录(证据链
  变成文件系统考古)。
- **D6 版本触发 → A 保存即版本 + 分析自动钉扎**(2026-07-08,用户选定):版本数保持
  人类尺度,且任何可报告数字必绑版本。**排除**:B 逐笔自动版本(CRDT 前噪声)、
  C 仅手动快照(人会忘,报告恰在关键时刻断链)。
