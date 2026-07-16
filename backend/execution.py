"""F3 阶段 1(EB-01 薄片):分析执行的单一分派点。

规格:docs/superpowers/specs/2026-07-16-analysis-execution-evidence-replay-v2.md
病根:quantify 走集成分派、report 走普通 ETA——报告因此对集成 LFT 模型发布错误频率
(锚点 C:C3 低估 3.6×、C1 生成物理不可能的正频率),并忽略 house/bc 设置。本模块把
"点序列该走哪条通道"收敛为一处,report 与 quantify 从此同源;集成模式无 MC 变体的
不确定性/重要度通道在此响亮拒绝(绝不回退普通 ETA——回退=EB-01 换面复发)。
"""
from __future__ import annotations


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
