"""ADR-3 确定性领域 lint(共享):AI 草案与人工模型统一口径的域规则检查。

与 ai_draft.validate_draft(结构/schema 层)互补,本层管领域语义:
- 溯源标记:AI 生成元素的 source/evidence 应含「AI 草案」(warning;应用层强制盖章)
- 置信声明:AI 草案不得自评 A/B 级置信(error —— ADR-3 默认 D)
- 接地:数值可带 library_ref 引用参考库条目;未知引用 = error,无引用 = warning(显式 ungrounded)
- 后果等级:leaf consequence 应为 C1..C5 或 ETA 自带 consequenceDefs 中的 id(error)
- FT 图:环检测(error;引擎会拒,提前在 lint 层给可读信息)、多余根提示(warning)
- id 卫生:引擎安全字符集 [A-Za-z0-9_-](error)
"""
from __future__ import annotations
import re
from typing import Any

_ID_RE = re.compile(r"^[A-Za-z0-9_\-一-鿿]+$")   # 引擎/MEF 安全;允许中文标识
_CONS = {"C1", "C2", "C3", "C4", "C5"}


def _src_of(x: dict) -> str:
    return str(x.get("source") or x.get("evidence") or "")


def _lint_numeric_grounding(kind: str, ident: str, obj: dict, library_ids: set[str],
                            errors: list[str], warnings: list[str]) -> None:
    ref = obj.get("library_ref")
    if ref is not None:
        if not isinstance(ref, str) or ref not in library_ids:
            errors.append(f"{kind} {ident}: library_ref '{ref}' 不在参考库中(数值引用必须可解析)")
        return
    warnings.append(f"{kind} {ident}: 数值未引用参考库(ungrounded),应用前需人工核对")


def _lint_ft_graph(ft: dict, where: str, errors: list[str], warnings: list[str]) -> None:
    nodes = {n.get("id"): n for n in ft.get("nodes", []) if isinstance(n, dict) and n.get("id")}
    # 环检测(白灰黑)
    WHITE, GREY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in nodes}

    def dfs(nid: str) -> bool:
        color[nid] = GREY
        for a in nodes[nid].get("args", []) or []:
            if a not in nodes:
                continue                              # 未定义引用由 schema 层报
            if color[a] == GREY:
                errors.append(f"{where}: 逻辑环经过 '{a}'(引擎将拒绝)")
                return False
            if color[a] == WHITE and not dfs(a):
                return False
        color[nid] = BLACK
        return True

    for nid in nodes:
        if color[nid] == WHITE and not dfs(nid):
            break
    # 多余根:除 top 外未被引用的门
    referenced: set[str] = set()
    for n in nodes.values():
        referenced.update(n.get("args", []) or [])
    top = ft.get("top")
    orphans = [nid for nid, n in nodes.items()
               if n.get("op") and nid != top and nid not in referenced]
    if orphans:
        warnings.append(f"{where}: 未被引用的门 {orphans}(疑似残留结构)")


def lint_draft(draft: dict[str, Any], library_ids: set[str] | None = None) -> dict[str, Any]:
    """对 AI 草案(或同形 payload 片段)做领域 lint。返回 {errors, warnings}。"""
    lib = library_ids or set()
    errors: list[str] = []
    warnings: list[str] = []

    def lint_fts(fts: Any, where: str) -> None:
        if not isinstance(fts, dict):
            return
        params = (fts.get("model_data") or {}).get("parameters", [])
        for p in params if isinstance(params, list) else []:
            if not isinstance(p, dict) or not p.get("id"):
                continue
            pid = str(p["id"])
            if not _ID_RE.match(pid):
                errors.append(f"{where} 参数 {pid}: id 含非法字符(引擎安全集: 字母数字_-)")
            if "AI 草案" not in _src_of(p):
                warnings.append(f"{where} 参数 {pid}: source 应标注「AI 草案,待人工审核」")
            g = p.get("grade")
            if isinstance(g, str) and g.upper() in ("A", "B"):
                errors.append(f"{where} 参数 {pid}: AI 草案不得自评置信 {g}(ADR-3 默认 D)")
            _lint_numeric_grounding("参数", f"{where}.{pid}", p, lib, errors, warnings)
        for ft in fts.get("fault_trees", []) if isinstance(fts.get("fault_trees"), list) else []:
            if isinstance(ft, dict):
                for n in ft.get("nodes", []) if isinstance(ft.get("nodes"), list) else []:
                    nid = str(n.get("id", "")) if isinstance(n, dict) else ""
                    if nid and not _ID_RE.match(nid):
                        errors.append(f"{where}.{ft.get('name')} 节点 {nid}: id 含非法字符")
                _lint_ft_graph(ft, f"{where}.{ft.get('name')}", errors, warnings)

    for i, eta in enumerate(draft.get("etas", []) if isinstance(draft.get("etas"), list) else []):
        if not isinstance(eta, dict):
            continue
        model = eta.get("model") if isinstance(eta.get("model"), dict) else {}
        where = f"etas[{i}]"
        defined = {d.get("id") for d in model.get("consequenceDefs", []) if isinstance(d, dict)} \
            if isinstance(model.get("consequenceDefs"), list) else set()
        for fe in model.get("functionalEvents", []) if isinstance(model.get("functionalEvents"), list) else []:
            if not isinstance(fe, dict) or not fe.get("id"):
                continue
            fid = str(fe["id"])
            if not _ID_RE.match(fid):
                errors.append(f"{where} 屏障 {fid}: id 含非法字符")
            g = fe.get("grade")
            if isinstance(g, str) and g.upper() in ("A", "B"):
                errors.append(f"{where} 屏障 {fid}: AI 草案不得自评置信 {g}(ADR-3 默认 D)")
            _lint_numeric_grounding("屏障", f"{where}.{fid}", fe, lib, errors, warnings)

        def walk(node: Any) -> None:
            if not isinstance(node, dict):
                return
            if node.get("kind") == "leaf":
                c = node.get("consequence")
                if isinstance(c, str) and c not in _CONS and c not in defined:
                    errors.append(f"{where}: 末态后果 '{c}' 不在 C1..C5 或自定义后果中")
                return
            walk(node.get("success"))
            walk(node.get("failure"))

        walk(model.get("root"))
        lint_fts(eta.get("fts"), where)

    lint_fts(draft.get("fts"), "fts")
    return {"errors": errors, "warnings": warnings}
