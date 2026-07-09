# ADR-1 实现计划:canonical 层(backend/canonical)

依 `specs/2026-07-08-adr1-project-document-schema-design.md`(D1–D4)。绞杀者第一步:
服务端规范层 + 无损互转,现有端点与前端不动。

## 步骤(TDD,每步可绿)

1. `backend/canonical/models.py` — Pydantic v1.0 模式(extra='forbid' → JSON Schema
   additionalProperties:false)。**v1 务实偏离(记录)**:①参数/故障树按 ETA 作用域
   (忠实于 v2 的每页签 fts;文档级归池属 Phase 3 规范化)②CCF members 暂存 ref 字符串
   ③FunctionalEvent 同时保留 pfd 参数(值+溯源)与 linked_fault_tree(缓存语义,见 spec 6.4 注)。
2. `ids.py` — 确定性 uuid5(项目命名空间 + kind:path),同内容双转同哈希(D6 幂等前提)。
3. `convert.py` — `to_canonical(v2, project_uuid) -> (doc, sidecar)`;`to_v2(doc, sidecar)`。
   sidecar = {view(activeKey/checkedKeys 原样), derived(pfds), passthrough(字段在位标记
   与 consequenceDefs 等未建模残留)} —— D2 的档外部分,保逐字段无损。缺 feId 的
   远古存档先规范化并打标(与前端 normalizeEta 行为一致,豁免字节等价)。
4. `serialize.py` — 规范 JSON(键排序/紧凑/UTF-8)+ content_hash(剥 created/modified)。
5. `engine_request.py` — canonical → EtQuantifyRequest(镜像前端 toEngineRequest 语义)。
6. `app.py`:`GET /api/schema/project-document/1.0`。
7. 测试:①round-trip(真实存档 saved/5d6520ef.json + 合成富例)+ 哈希确定性
   ②引擎请求逐字段等于既有 API 测试的手写请求(纯 PFD 例 + 共享事件 0.109 例)且
   quantify 数值逐位一致 ③schema 端点 + 5 内置场景构造的 v2 全部通过校验(仅结构,
   不断言数值 —— 数据修正并行进行)。

## 验收 → spec §6.7;基线:后端 156 pass 不动。
