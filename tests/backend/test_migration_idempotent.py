"""Phase 5 acceptance:单机 data/projects.db 导入共享服务器幂等无损(规格 §9)。

设计事实(不是新写的迁移代码,是验证既有 ADR-2 设计确实兑现了这个承诺):
迁移机制 = **直接拷贝 db 文件**,没有专门的"导入"端点/脚本 —— 因为
① 项目用内容派生的 uuid 标识(legacy sid → uuid5,或原生 uuid),不依赖某台服务器的
  自增序列;② 版本按内容哈希寻址,`UNIQUE(project_uuid, content_hash)` 天然去重;
③ `_conn()` 每次开库都对 `_DDL` 跑 `CREATE TABLE/TRIGGER/INDEX IF NOT EXISTS`(见
  store.py `_conn`),旧 schema 的库文件被新代码打开时自动"迁移"到当前 schema,
  没有显式迁移步骤。三条放在一起 = "拷文件就是迁移,且拷完可以放心继续写"。

本测试验证的正是这三条,而不是某个尚不存在的 import 端点。
"""
import sqlite3

from backend import store
from backend.canonical import to_canonical

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"


def _payload(fail: float) -> dict:
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": fail}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def test_pre_phase5_schema_db_opens_cleanly_under_current_code(tmp_path):
    """模拟"单机上跑了很久、schema 还停在 Phase 5 之前"的 projects.db:
    手工建一份只有 projects/versions/audit_log 三张表(无 reviews/accounts/sessions)
    的库,直接指过去,断言当前代码零迁移脚本地正常读写,新表自动就位。"""
    db_path = str(tmp_path / "legacy_shape.db")
    cx = sqlite3.connect(db_path)
    cx.executescript("""
        CREATE TABLE projects(
          uuid TEXT PRIMARY KEY, name TEXT NOT NULL,
          created_at TEXT NOT NULL, modified_at TEXT NOT NULL, meta_json TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE versions(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_uuid TEXT NOT NULL REFERENCES projects(uuid),
          content_hash TEXT NOT NULL, parent_version_id INTEGER,
          canonical_json TEXT NOT NULL, sidecar_json TEXT,
          created_at TEXT NOT NULL, actor TEXT NOT NULL,
          origin TEXT NOT NULL CHECK(origin IN ('save','auto_pin','import')),
          message TEXT, UNIQUE(project_uuid, content_hash));
        CREATE TABLE audit_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
          action TEXT NOT NULL, project_uuid TEXT, version_id INTEGER, entity_uuid TEXT,
          details_json TEXT NOT NULL DEFAULT '{}');
    """)
    old_created_at = "2026-05-01T00:00:00+00:00"
    cx.execute("INSERT INTO projects VALUES(?,?,?,?,?)",
              (PUUID, "旧项目(Phase 5 前)", old_created_at, old_created_at, "{}"))
    cx.execute("INSERT INTO audit_log(ts,actor,action,project_uuid) VALUES(?,?,?,?)",
              (old_created_at, "liqingchuan@bess-psa/0.0.9", "project.create", PUUID))
    cx.commit()
    cx.close()

    # "拷贝到共享服务器" = 现在用当前代码指向同一个文件(等价于文件已经被拷过去了)
    store.configure(db_path)

    # 事实①②③:旧数据完好可读;新表(reviews/accounts/sessions)自动就位、可用;
    # 继续写(新版本/新审计)不受影响,且与旧行共存不冲突
    projects = store.list_projects()
    assert any(p["uuid"] == PUUID and p["name"] == "旧项目(Phase 5 前)" for p in projects)
    old_audit = store.list_audit(PUUID)
    assert any(e["action"] == "project.create" and e["actor"] == "liqingchuan@bess-psa/0.0.9"
              for e in old_audit)

    v = store.create_version(PUUID, *to_canonical(_payload(0.1), PUUID))
    assert v["created"] is True
    store.submit_review(PUUID, v["id"], note="迁移后继续送审")   # 证明 reviews 表已自动建好
    assert store.list_reviews(PUUID)[0]["state"] == "in_review"
    store.create_account("newadmin", "post-migrate-pw", "admin")  # 证明 accounts 表已自动建好
    assert store.verify_credentials("newadmin", "post-migrate-pw") is not None


def test_reopening_same_db_file_is_idempotent_no_duplicate_versions(tmp_path):
    """"拷贝"本身可以重复做(比如先同步一次,后来又同步一次)—— 同内容不产生重复版本,
    审计只增不重复历史行(拷贝操作本身不写审计,只是重新指向同一文件)。"""
    db_path = str(tmp_path / "projects.db")
    store.configure(db_path)
    store.ensure_project(PUUID, "P")
    v1 = store.create_version(PUUID, *to_canonical(_payload(0.1), PUUID))

    # 模拟"再次拷贝同一份文件到服务器,重新连接" —— 对同库重新 configure 是等价操作
    store.configure(db_path)
    v2 = store.create_version(PUUID, *to_canonical(_payload(0.1), PUUID))   # 同内容
    assert v2["created"] is False and v2["id"] == v1["id"]
    assert len(store.list_versions(PUUID)) == 1
