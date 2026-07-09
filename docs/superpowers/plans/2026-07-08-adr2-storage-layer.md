# ADR-2 实现计划:存储/版本化/审计(backend/store)

依 `specs/2026-07-08-adr2-storage-versioning-audit-design.md`(D5/D6)。绞杀者第二步:
在 ADR-1 canonical 层之上落存储三环;旧 `/api/saved` 行为不变(文件仍是旧端点权威),
版本库并行累积。

## 步骤

1. `backend/store.py` — 单文件 SQLite(`data/projects.db`,gitignore),四表 + audit
   只增触发器(RAISE ABORT 双保险);`create_version` 按 (project, content_hash) 幂等;
   parent 链;actor = OS 用户 + 应用版本;**versions 表加 `sidecar_json` 列**(计划级
   决定:绞杀期保逐字段无损服务/round-trip,canonical_json 仍是语义权威)。
2. 遗留映射:`legacy_project_uuid(sid) = uuid5(ns, "legacy-saved:{sid}")` —— 无映射表,
   再保存与导入天然汇聚同一项目。
3. `/api/saved` 双写:POST 成功后 canonical 化入版本库(try/except 保旧契约——
   非 v2 载荷跳过,响应多出 `version` 键为增量信息)。读/删仍走文件。
4. `backend/import_legacy.py` — saved/*.json 一次性导入(v2 直转;pre-v2 按前端
   deserializeProject 语义包裹);幂等(uuid5 + 哈希幂等)。CLI:`python -m backend.import_legacy`。
5. 只读端点:`GET /api/projects{,/uuid,/versions,/versions/{id},/audit,/cases}`。
   diff 端点(Model Compare)后置——依赖 differ,归 parity #5。
6. 报告钉扎:`ReportRequest` 增可选 `project_uuid + project_payload`(同给生效)→
   auto_pin 版本(幂等)→ `analysis_cases(kind='report')`(settings/results/事后
   artifacts:sha256+文件名)→ 三种格式页脚 `_evidence_line`(案例#/版本哈希8/引擎版本)。
   前端 Phase 3 接线;当前 API 直测。**范围注**:uncertainty/importance 端点的钉扎与
   "读路径切版本库"随 Phase 3 前端接线一并做,本期不动。
7. 测试:`tests/backend/conftest.py` autouse 隔离 db → tmp;`test_store.py`(幂等/
   parent 链/审计只增属性/导入 round-trip);`test_projects_api.py`(双写、非 v2 容错、
   端点、报告钉扎:case.version.hash == hash(to_canonical(payload)) + CSV 页脚断言)。

## 验收 → spec §四:1/2/3/4 全绿;基线 168 py 不动。
