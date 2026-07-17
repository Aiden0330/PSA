"""F3 阶段 1(EB-01 薄片):分析执行的单一分派点。

规格:docs/superpowers/specs/2026-07-16-analysis-execution-evidence-replay-v2.md
病根:quantify 走集成分派、report 走普通 ETA——报告因此对集成 LFT 模型发布错误频率
(锚点 C:C3 低估 3.6×、C1 生成物理不可能的正频率),并忽略 house/bc 设置。本模块把
"点序列该走哪条通道"收敛为一处,report 与 quantify 从此同源;集成模式无 MC 变体的
不确定性/重要度通道在此响亮拒绝(绝不回退普通 ETA——回退=EB-01 换面复发)。
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


# ── EB-02 请求哈希(F3 阶段 2,收口二轮改为语义投影):钉扎一致性的比对基元 ────────
# request_hash = 引擎请求的**模型指纹**,取自语义投影白名单——只哈希 et_builder/引擎实际
# 消费的字段(结构、参数值与类型、序列、后果分箱、CCF、bc 集**定义**、集成 ie 块语义)。
# 白名单取代初版黑名单+去空:label/树内 name 等呈现字段天然出局(收口二轮 F-2:前端给每个
# 用户新增门盖 label,黑名单法对真实编辑流一律 409 误拒),param_ref 自引用规范化,数字统一
# float(int 1 与 1.0 同值同哈希)。_TYPED_PARAM_FIELDS 与 et_builder 的透传清单同源——引擎
# 新增 typed 字段时两处同步,否则指纹对新语义失明。
#
# 指纹**不含**(经 domain-reviewer 裁可的口径:模型身份 ↔ 运行设置分工):
#   - house_states / boundary_condition_set(按名选择):运行时叠加,逐字记入案例
#     resolved_settings(重放 = 钉扎版本反构 + resolved_settings 叠加);
#   - samples/seed/error_factor(MC 设置)、scenario/labels/consequence_defs/tree_png/
#     format(呈现)、project_uuid/payload(钉扎上下文)、scope/trees(聚合另路)。
# 指纹**含**(收口二轮 F-1/F-3 修正):
#   - boundary_condition_sets(命名集**定义**):定义是模型内容(et_builder 喂进 Model),
#     改定义必须改指纹,否则"维护工况"重定义后结果仍钉到旧定义版本(D-1 静默替换);
#   - ie_fault_tree 块语义(树 + typed 参数):集成模式的 Σλ·P 由它决定;此时标量
#     init_frequency 被引擎忽略 → 出局(前端画布残值不得造成误拒)。
_TYPED_PARAM_FIELDS = ("mttr", "test_interval", "mission_time",
                       "gamma", "alpha", "beta", "t0")

REQUEST_HASH_SCHEME = "model-fingerprint-v2"


def _num(v: Any) -> Any:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v


def _proj_param(spec: Any) -> dict:
    if not isinstance(spec, dict):                    # 裸标量旧形状 = probability
        return {"kind": "probability", "value": _num(spec)}
    out: dict[str, Any] = {"kind": spec.get("kind") or "probability",
                           "value": _num(spec.get("value"))}
    for f in _TYPED_PARAM_FIELDS:
        if spec.get(f) is not None:
            out[f] = _num(spec[f])
    return out


def _proj_node(n: dict) -> dict:
    if n.get("basic"):
        out: dict[str, Any] = {"id": n["id"], "basic": True}
        pr = n.get("param_ref")
        if pr is not None and pr != n["id"]:          # 自引用(param_ref==id/缺省)规范化为省略
            out["param_ref"] = pr
        return out
    if n.get("house"):
        out = {"id": n["id"], "house": True}
        if n.get("state") is not None:
            out["state"] = bool(n["state"])
        return out
    out = {"id": n["id"], "op": n.get("op"),
           "args": [str(a) for a in (n.get("args") or [])]}
    if n.get("k") is not None:
        out["k"] = int(n["k"])
    return out


def _proj_tree(t: dict) -> dict:
    return {"top": t["top"], "nodes": [_proj_node(n) for n in (t.get("nodes") or [])]}


def _proj_fe(fe: dict) -> dict:
    if fe.get("link_ft"):
        return {"id": fe["id"], "link_ft": fe["link_ft"]}
    return {"id": fe["id"], "pfd": _num(fe.get("pfd"))}


def _proj_ccf(c: dict) -> dict:
    out: dict[str, Any] = {"id": c["id"], "members": [str(m) for m in (c.get("members") or [])],
                           "model": c.get("model", "beta"),
                           "factors": {str(k): _num(v) for k, v in (c.get("factors") or {}).items()}}
    if c.get("staggered"):                            # 错开检验是语义(展开公式不同)
        out["staggered"] = True
    return out


def _proj_bc(b: dict) -> dict:
    return {"name": b["name"],
            "house_states": {str(k): bool(v) for k, v in (b.get("house_states") or {}).items()}}


def _proj_ie(block: dict) -> dict:
    # 参数按 id 排序:块内参数语义上是集合(前端按 ie 树节点序生成,反构按 canonical 节点序)。
    return {"top": block["top"],
            "nodes": [_proj_node(n) for n in (block.get("nodes") or [])],
            "parameters": sorted(
                ({"id": p["id"], "kind": p.get("kind", "probability"), "value": _num(p["value"])}
                 for p in (block.get("parameters") or [])), key=lambda p: p["id"])}


def request_hash(req: dict) -> str:
    """模型指纹 = sha256(语义投影的规范 JSON):键排序、数字统一 float、呈现字段出局。"""
    keep: dict[str, Any] = {
        "init_event": req["init_event"],
        "functional_events": [_proj_fe(f) for f in (req.get("functional_events") or [])],
        "fault_trees": {str(k): _proj_tree(t) for k, t in (req.get("fault_trees") or {}).items()},
        "parameters": {str(k): _proj_param(v) for k, v in (req.get("parameters") or {}).items()},
        "sequences": [{"path": {str(k): str(v) for k, v in (s.get("path") or {}).items()},
                       "end_state": s["end_state"]} for s in (req.get("sequences") or [])],
        "consequence_bins": {str(k): str(v) for k, v in (req.get("consequence_bins") or {}).items()},
    }
    if req.get("ccf_groups"):
        keep["ccf_groups"] = [_proj_ccf(c) for c in req["ccf_groups"]]
    if req.get("boundary_condition_sets"):
        keep["boundary_condition_sets"] = [_proj_bc(b) for b in req["boundary_condition_sets"]]
    ie = req.get("ie_fault_tree")
    if ie:
        keep["ie_fault_tree"] = _proj_ie(ie)
    else:
        keep["init_frequency"] = _num(req["init_frequency"])
    blob = json.dumps(keep, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class UnsupportedIntegratedAnalysis(ValueError):
    """集成 LFT 模式下请求了尚不存在的通道(MC 不确定性 / 屏障重要度)。
    引擎侧确无 integrated 变体(uncertainty.py / barrier_importance_exact 无 ie 入口);
    v2 候选(LFT 规格 §6)。端点映射 422,绝不静默回退普通 ETA。"""


def resolve_ie_ft_name(ie_fault_tree) -> str | None:
    """从请求的 ie_fault_tree 块解析集成通道的 IE 树名;None ⇒ 普通 ETA。"""
    if not ie_fault_tree:
        return None
    return ie_fault_tree.get("name", "__init__")


def point_sequences(model, et_name: str, ie_ft_name: str | None,
                    house_states: dict | None, boundary_condition_set: str | None) -> list[dict]:
    """点估计逐序列(频率降序),按 ie_ft_name 分派集成/普通——单一真源。
    行形两通道一致:{end_state, path, consequence, frequency}。"""
    from psaengine.eta.sequence import (event_tree_sequences,
                                        event_tree_sequences_integrated)
    if ie_ft_name is not None:
        return event_tree_sequences_integrated(
            model, et_name, ie_ft_name,
            house_states=house_states, boundary_condition_set=boundary_condition_set)
    return event_tree_sequences(
        model, et_name,
        house_states=house_states, boundary_condition_set=boundary_condition_set)
