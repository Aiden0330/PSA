/** F-α(前端评审 FE-01):分析请求的**唯一**构造器。
 *
 * 量化、重要度、报告导出(单树)必须且只能经此构造——此前报告路径裸调
 * toEngineRequest,集成 LFT 块、CCF、house/边界设置被静默丢弃:屏幕显示集成数、
 * 报告算标量数,且 F3 后的钉扎按"标量模型"核验通过(错数带核验章)。
 * 语义 = withIeFaultTree(toEngineRequest(m, linked), m, linked) + 编辑器会话
 * 边界设置(etEngineOptions)合入;三消费方逐字段同源(契约测试锁定)。
 */
import { toEngineRequest, withIeFaultTree } from '../../eventtree'
import type { EtQuantifyRequest, EventTreeModel } from '../../eventtree'

export interface EtEngineOptions {
  house_states?: Record<string, boolean>
  boundary_condition_set?: string
  boundary_condition_sets?: unknown[]
}

export function buildAnalysisRequest(
  m: EventTreeModel,
  linked?: { fault_trees: any[]; parameters: any[]; ccf_groups?: any[] },
  etEngineOptions?: EtEngineOptions,
): EtQuantifyRequest & EtEngineOptions {
  return { ...withIeFaultTree(toEngineRequest(m, linked), m, linked), ...(etEngineOptions ?? {}) }
}
