"""C 阶段:证据链监管演练(SC_ISC 项目,真机)。

演练脚本 = 监管方问答的可执行化:
  Q1 案例绑定强度可辨?  Q2 从钉扎版本反构重放逐位?  Q3 边界条件集定义落卷可复算?
  Q4 送审→签发→报告页脚带签发行?  Q5 审计只增留痕?
"""
import json
import sys
import urllib.request
import uuid

sys.path.insert(0, ".")
BASE = "http://127.0.0.1:8000"
PUUID = str(uuid.uuid5(uuid.NAMESPACE_URL, "pilot-200mwh/SC_ISC"))


def post(path, body, raw=False):
    r = urllib.request.Request(f"{BASE}{path}", data=json.dumps(body).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=180) as f:
            data = f.read()
            return f.status, (data.decode("utf-8", "replace") if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=60) as f:
        return json.loads(f.read())


ok = lambda cond, msg: print(("  ✔ " if cond else "  ✘ ") + msg) or cond
fails = 0

# ── Q1:案例绑定强度 + 指纹 ──────────────────────────────────────────────────────
cases = get(f"/api/projects/{PUUID}/cases")
print(f"Q1 案例({len(cases)} 个,项目 {PUUID[:8]}):")
report_case = next(c for c in cases if c["kind"] == "report")
st = json.loads(report_case["settings_json"])
fails += not ok(st.get("pin_binding") == "request_hash_verified", f"pin_binding={st.get('pin_binding')}")
fails += not ok(bool(st.get("request_hash")), f"request_hash={str(st.get('request_hash'))[:16]}…")
fp = st.get("engine_fingerprint", {})
fails += not ok(fp.get("semver") == "0.2.0" and fp.get("git_sha"),
                f"指纹 semver={fp.get('semver')} git={fp.get('git_sha')} dirty={fp.get('dirty')} corpus={fp.get('benchmark_corpus_version')}")

# ── Q2:反构重放逐位 ────────────────────────────────────────────────────────────
print("Q2 反构重放(钉扎版本 → canonical → 引擎请求 → 复算):")
from backend import store
from backend.canonical import build_engine_request
from backend.canonical.models import ProjectDocument
from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree

raw = store.get_version_raw(PUUID, report_case["version_id"])
doc = ProjectDocument.model_validate(raw[0])
req = build_engine_request(doc, "sc:SC_ISC")
# 通道同源重放(P-1 发现):钉扎值出自报告通道(point_sequences 频率降序逐行累加);
# quantify 通道求和序不同 → C2/C4 差最后 2-3 ULP。逐位承诺 = 同通道重放。
from backend.execution import point_sequences
model_r = build_model_from_request(req)
replay = {}
for row in point_sequences(model_r, "TR", None, None, None):
    replay[row["consequence"]] = replay.get(row["consequence"], 0.0) + row["frequency"]
pinned = json.loads(report_case["results_json"])["consequences"]
bit = all(replay.get(c, 0.0) == pinned.get(c, 0.0) for c in ("C1", "C2", "C3", "C4", "C5"))
fails += not ok(bit, f"重放(报告通道同源)C3={replay['C3']:.6e} vs 钉扎 {pinned.get('C3'):.6e}"
                     f" —— {'五类逐位一致' if bit else '不一致!'}")
qc = quantify_event_tree(model_r, "TR")["consequences"]
ulp = [c for c in ("C1", "C2", "C3", "C4", "C5") if qc.get(c, 0.0) != replay.get(c, 0.0)]
print(f"  (P-1 记录:quantify 通道与报告通道求和序不同,ULP 级分歧类 = {ulp})")

# ── Q3:边界条件集(年度检修)落卷 + 复算 ─────────────────────────────────────────
print("Q3 边界条件集定义落卷:")
payload_v2 = None   # 从版本反构 v2 载荷(sidecar-less canonical-normal)
defs = req.get("boundary_condition_sets")
fails += not ok(defs == [{"name": "年度检修", "house_states": {"H_MAINT": True}}],
                f"反构携带定义 {defs}")
on = quantify_event_tree(build_model_from_request(req), "TR",
                         boundary_condition_set="年度检修")["consequences"]
fails += not ok(on["C5"] > replay["C5"], f"检修工况 C5 {on['C5']:.3e} > 基态 {replay['C5']:.3e}(热管理退出,风险上移)")

# ── Q4:送审 → 签发 → 页脚签发行 ─────────────────────────────────────────────────
print("Q4 评审签发流:")
vid = report_case["version_id"]
s, sub = post(f"/api/projects/{PUUID}/reviews", {"version_id": vid, "note": "试点演练送审"})
fails += not ok(s == 200, f"送审 HTTP {s}")
s, sig = post(f"/api/projects/{PUUID}/reviews/{vid}/sign", {"note": "试点演练签发"})
fails += not ok(s == 200, f"签发 HTTP {s} {str(sig)[:80]}")
# 重导报告:必须用**原始载荷**(build_scenario 确定性重建)——canonical-normal 再生
# 载荷 content_hash 不命中已签发版本(导出门 = 逐字节幂等,设计如此;演练发现 P-2 注记)。
sys.path.insert(0, "/private/tmp/claude-501/-Users-liqingchuan-Documents-projects-PSA-BESS/f7bb5806-e7da-42b2-be7f-1f293a437cd1/scratchpad")
from pilot_station import build_scenario, _lib_ie_priors
sc = next(s for s in json.load(open("bess/scenarios.json"))["scenarios"] if s["id"] == "SC_ISC")
eta = build_scenario(sc, _lib_ie_priors())
payload = {"v": 2, "etas": [eta], "activeKey": eta["key"], "checkedKeys": {eta["key"]: True}}
flatreq = req  # 计算请求不变
s, rep = post("/api/report?format=csv",
              {**flatreq, "project_uuid": PUUID, "project_payload": payload,
               "scenario_name": "电芯内短 → 热失控", "samples": 2000, "seed": 42}, raw=True)
footer = next((ln for ln in rep.splitlines() if "评价依据" in ln), "") if s == 200 else str(rep)
signed = "签发" in footer and "工作稿" not in footer
fails += not ok(s == 200 and signed, f"页脚:{footer[:180]}")
fails += not ok("模型绑定已核验" in footer, "页脚绑定标记=已核验")

# ── Q5:审计留痕 ────────────────────────────────────────────────────────────────
print("Q5 审计:")
audit = get(f"/api/projects/{PUUID}/audit")
acts = [a["action"] for a in audit]
need = {"report.export", "review.submit", "review.sign"}
fails += not ok(need.issubset(set(acts)), f"审计动作覆盖 {sorted(set(acts))[:8]} ⊇ {sorted(need)}")

print(f"\n演练结果:{'全部通过' if fails == 0 else f'{fails} 项失败'}")
sys.exit(1 if fails else 0)
