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


# ── EB-02 请求哈希(F3 阶段 2):钉扎一致性的比对基元 ──────────────────────────
# request_hash = build_model_from_request 输入的**模型指纹**:同一初因(事件+频率)、
# 功能事件、故障树、参数、序列、后果分箱、CCF → 同一哈希。PFD=.9 算出的报告因此无法钉到
# PFD=.1 的版本(EB-02:结果绑到无关版本)。_pin_case 从钉扎版本反构逐树请求各自 hash,
# 计算所用请求的 hash 必须在集合内,否则 409 拒绝绑定。
#
# 剔除清单(显式常量 + 逐条理由):
#   - project_uuid/project_payload:钉扎上下文,非模型内容。
#   - scenario_name/tree_png/labels/consequence_defs:报告呈现,不入量化。
#   - samples/seed/error_factor:MC 设置(记入 resolved_settings,不定义模型版本)。
#   - format:导出格式。
#   - scope/trees:checked_set 聚合专用字段(聚合路径不走单请求一致性)。
#   - house_states/boundary_condition_set(s)/ie_fault_tree:运行时叠加/集成 IE 块。
#     反构自 canonical 无法复现运行时 house 覆盖,也无法复现前端 withIeFaultTree 的
#     IE 参数分流——纳入哈希会误拒合法的 house/集成钉扎。三者逐字记入案例 resolved_settings
#     (重放据此叠加),但**不定义**"结果来自哪个模型版本",故不入模型指纹。
# 说明(与规格 §2.3 字面"留 house/bc/ie"的偏离):见落地说明,交协调者收口复核。
_REQUEST_HASH_DROP = frozenset({
    "project_uuid", "project_payload",
    "scenario_name", "tree_png", "labels", "consequence_defs",
    "samples", "seed", "error_factor",
    "format",
    "scope", "trees",
    "house_states", "boundary_condition_set", "boundary_condition_sets",
    "ie_fault_tree",
})


def _is_empty(v: Any) -> bool:
    return v is None or v == {} or v == []


def _clean(v: Any) -> Any:
    """Recursively drop None/empty-collection members so representational
    differences (pydantic's `link_ft: null` vs an omitted key, `ccf_groups: []`
    vs absent) never cause a false hash mismatch — only genuine model content
    survives into the fingerprint."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items() if not _is_empty(x)}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def request_hash(req: dict) -> str:
    """内容哈希 = 规范化(剔除运行/呈现字段 + 深度去空 + 键排序 + 浮点稳定 repr)的模型指纹。"""
    keep = {k: _clean(v) for k, v in req.items()
            if k not in _REQUEST_HASH_DROP and not _is_empty(v)}
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
