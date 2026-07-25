/**
 * `no-stale-model-set` —— 禁止用渲染期快照算模型再整体覆写(丢改动病根,报障 2026-07-17)。
 *
 * 病理:`api.set(addGate(model, ftName, op))` 里的 `model` 是**渲染那一刻**的 props/state
 * 快照。同一拍内两次编辑(快速连点、逐键输入、程序化连续调用)时,第二次仍从旧快照起算,
 * 整体覆写把第一次的结果冲掉——用户看到"改了没保存"。store 与 useModel 的 set 都原生
 * 支持函数式 updater,正解是 `api.set((prev) => addGate(prev, ftName, op))`。
 *
 * 检测:形如 `<recv>.set(...)` / `set(...)` / `cvSet(...)` / `writeEtModel(...)` /
 * `onChange(...)` 等**写函数**的首个实参是「调用表达式」且该调用的**首参是标识符**
 * (即把某个模型变量整体喂进变换函数)。函数式 updater(箭头/函数表达式)一律放行。
 *
 * 白名单:首参不是标识符的调用(如 `f(prev.x)`、`g()`)不报——那多半不是快照覆写;
 * 需要豁免的个别行用 `// eslint-disable-next-line psa/no-stale-model-set` 并写明理由。
 */
const WRITER_NAMES = new Set([
  'set', 'cvSet', 'localSet', 'etaSet', 'writeEtModel', 'onChange',
  'setEtaFts', 'setUserFts', 'setEtaModel', 'onRowsChange', 'persist',
])

/** 模型变换函数名(model.ts / eventtree.ts 的纯函数);命中即高置信度报错。 */
const MUTATORS = new Set([
  'addGate', 'addBasic', 'addBasicFromLib', 'connect', 'deleteNode', 'updateNode',
  'updateParam', 'setParamKind', 'setTop', 'renameNode', 'setCcf', 'setBcSets',
  'addFaultTree', 'deleteFaultTree',
  'addFe', 'delFe', 'reorderFe', 'renameFe', 'setFailProb', 'setLinkFt', 'branchLeaf',
  'collapseNode', 'setConsequence', 'setBranchFe', 'applyFieldUpdate', 'setInitEvent',
  'setInitFreq', 'setInitFreqSource', 'setProduct', 'addBarrierFromLib',
  'addConsequence', 'updateConsequence', 'delConsequence',
])

const calleeName = (node) => {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && node.property && node.property.type === 'Identifier') {
    return node.property.name
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        '模型写操作必须传函数式 updater((prev) => …),禁止用渲染期快照算好再整体覆写',
    },
    schema: [],
    messages: {
      stale:
        '用渲染期快照覆写模型:`{{writer}}({{mutator}}({{arg}}, …))`。同一拍内的第二次编辑会' +
        '基于旧快照重算并冲掉第一次(丢改动病根 2026-07-17)。改为 ' +
        '`{{writer}}((prev) => {{mutator}}(prev, …))`。',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const writer = calleeName(node.callee)
        if (!writer || !WRITER_NAMES.has(writer)) return
        const first = node.arguments[0]
        if (!first || first.type !== 'CallExpression') return          // 函数式 updater / 字面量 → 放行
        const mutator = calleeName(first.callee)
        if (!mutator || !MUTATORS.has(mutator)) return                 // 非模型变换 → 不臆断
        const inner = first.arguments[0]
        if (!inner || inner.type !== 'Identifier') return              // 首参非标识符 → 非快照覆写
        context.report({
          node: first,
          messageId: 'stale',
          data: { writer, mutator, arg: inner.name },
        })
      },
    }
  },
}
