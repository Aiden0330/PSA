/** `psa/no-stale-model-set` 规则自身的锁测(2026-07-22)。
 *
 * 规则是本周"改动丢失"病根的机制性护栏:模型写必须函数式 updater。规则若被误改成
 * 恒不报(或误报到让人 disable 它),护栏就名存实亡 —— 故对规则本身做正/负例锁。
 */
import { describe, expect, it } from 'vitest'
import { RuleTester } from 'eslint'

// 规则文件是纯 JS(ESLint 直接加载,不进 tsc 项目引用)——此处按运行时形状引入
// @ts-expect-error: 无 .d.ts,规则对象只在本测试里当 RuleTester 入参用
import rule from '../eslint-rules/no-stale-model-set.js'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

function run(name: string, cases: { valid: string[]; invalid: string[] }) {
  it(name, () => {
    expect(() => tester.run('no-stale-model-set', rule as never, {
      valid: cases.valid.map((code) => ({ code })),
      invalid: cases.invalid.map((code) => ({ code, errors: 1 })),
    })).not.toThrow()
  })
}

describe('psa/no-stale-model-set', () => {
  run('值式覆写(快照进变换函数)必报', {
    valid: [],
    invalid: [
      'api.set(addGate(model, ftName, op))',
      'cvSet(connect(cvModel, cvFtName, s, t))',
      'onChange(renameFe(model, idx, v))',
      'writeEtModel(addFe(etModel))',
      'P().setUserFts(deleteFaultTree(userFtsModel, name))',
      'localSet(deleteNode(model, ftName, id))',
    ],
  })

  run('函数式 updater 与非模型写一律放行', {
    valid: [
      'api.set((prev) => addGate(prev, ftName, op))',
      'cvSet((prev) => connect(prev, cvFtName, s, t))',
      'onChange((prev) => renameFe(prev, idx, v))',
      'writeEtModel((prev) => { const m = addFe(prev); return m })',
      'setState(computeSomething(x))',          // 非白名单写函数
      'api.set(buildFromScratch(a, b))',        // 非模型变换函数
      'api.set(addGate(prev.model, ftName, op))', // 首参非标识符(非快照整体覆写)
      'api.set(EMPTY_FTS)',
      'onChange(nextModel)',
    ],
    invalid: [],
  })
})
