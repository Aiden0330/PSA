import { getAiConfig, putAiConfig } from '../aiDraft'
import type { AiConfig } from '../aiDraft'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { AiApplyMode, AiDraftResponse, DraftElement } from '../aiDraft'
import type { FuncEvent } from '../eventtree'
import { Icon } from './icons'

interface AiDraftPanelProps {
  goal: string
  mode: AiApplyMode
  targetEtaName?: string
  targetFeId: string
  targetFeLabel?: string
  functionalEvents: FuncEvent[]
  draft: AiDraftResponse | null
  busy: boolean
  error: string | null
  onGoalChange: (goal: string) => void
  onModeChange: (mode: AiApplyMode) => void
  onTargetFeIdChange: (id: string) => void
  onGenerate: () => void
  /** 截图转录(2026-08-17):≤3 张任意工具的 ETA/FTA 截图 */
  images?: { name: string; media_type: string; data: string }[]
  onAddImages?: (files: File[]) => void
  onRemoveImage?: (i: number) => void
  onApply: () => void
  onClose: () => void
  /** D7 ghost-diff:草案元素清单 + 接受集(缺省 = 不渲染逐元素区) */
  elements?: DraftElement[]
  acceptedIds?: string[]
  onToggleElement?: (id: string) => void
}

const modeOptions: { mode: AiApplyMode; label: string }[] = [
  { mode: 'new_eta', label: '生成新 ETA' },
  { mode: 'fta_for_barrier', label: '为当前屏障生成 FTA' },
  { mode: 'complete_eta', label: '补全当前 ETA' },
]

function recordLine(row: Record<string, unknown>): string {
  const item = row.item ?? row.id ?? row.target ?? row.name ?? 'trace'
  const source = row.source ?? row.evidence ?? row.reference ?? row.citation
  return source ? `${String(item)}: ${String(source)}` : JSON.stringify(row)
}

function namesFromDraft(draft: AiDraftResponse): string[] {
  const etaNames = (draft.etas ?? []).map((eta) => eta.name || eta.model?.initEvent).filter(Boolean)
  const ftNames = (draft.fts?.fault_trees ?? []).map((ft) => ft.name).filter(Boolean)
  return [...etaNames, ...ftNames]
}

function etaNamesFromDraft(draft: AiDraftResponse): string[] {
  return (draft.etas ?? []).map((eta) => eta.name || eta.model?.initEvent).filter(Boolean)
}

function ftNamesFromDraft(draft: AiDraftResponse): string[] {
  return (draft.fts?.fault_trees ?? []).map((ft) => ft.name).filter(Boolean)
}

function firstName(names: string[], fallback: string): string {
  return names[0] || fallback
}

/** AI 设置区(2026-08-17):供应商/模型/API key。懒展开(点开才 fetch);
 *  密钥输入永不回填原文(placeholder 显掩码提示),保存后即清空输入框。 */
function AiConfigSection() {
  const [open, setOpen] = useState(false)
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [modelSel, setModelSel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [providerSel, setProviderSel] = useState<'example' | 'anthropic' | 'openai'>('anthropic')
  const [enabledSel, setEnabledSel] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try {
      const c = await getAiConfig()
      setCfg(c); setModelSel(c.model); setEnabledSel(c.enabled); setBaseUrl(c.base_url ?? '')
      setProviderSel(c.provider === 'anthropic' || c.provider === 'openai' ? c.provider : 'example')
    } catch (e) { setMsg(String((e as Error)?.message ?? e)) }
  }
  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const c = await putAiConfig({
        enabled: enabledSel, provider: providerSel, model: modelSel,
        base_url: baseUrl.trim(),                    // "" = 清除(回退官方默认/环境变量)
        ...(keyInput.trim() ? { api_key: keyInput.trim() } : {}) })
      setCfg(c); setKeyInput('')
      setMsg('已保存(密钥落本地 0600 文件,不入库不回显)')
    } catch (e) { setMsg(String((e as Error)?.message ?? e)) }
    finally { setBusy(false) }
  }
  return (
    <div style={{ borderTop: '1px solid var(--psa-line-2)', marginTop: 10, paddingTop: 8 }}>
      <button data-testid="ai-config-toggle" className="psa-btn" style={{ fontSize: 11.5 }}
        onClick={() => { const n = !open; setOpen(n); if (n && !cfg) void load() }}>
        ⚙ AI 设置{cfg ? `(${providerSel} · ${modelSel}${cfg.api_key_set ? ' · 密钥已设' : ' · 无密钥'})` : ''}
      </button>
      {open && (
        <div data-testid="ai-config-body" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={enabledSel} onChange={(e) => setEnabledSel(e.target.checked)} />
            启用 AI 草案(等效 PSA_AI_ENABLED=1)
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>供应商
            <select value={providerSel} onChange={(e) => setProviderSel(e.target.value as 'example' | 'anthropic' | 'openai')} style={{ fontSize: 12 }}>
              <option value="anthropic">anthropic(Claude,官方 API)</option>
              <option value="openai">openai 兼容(GPT / DeepSeek / Gemini)</option>
              <option value="example">example(离线演示,忽略截图)</option>
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>模型
            <select value={(providerSel === 'openai' ? cfg?.models_openai : cfg?.models)?.includes(modelSel) ? modelSel : '__custom'}
              onChange={(e) => { if (e.target.value !== '__custom') setModelSel(e.target.value) }} style={{ fontSize: 12 }}
              title={providerSel === 'openai' ? '参考清单(以供应商文档为准);自定义直接改右侧输入' : undefined}>
              {((providerSel === 'openai' ? cfg?.models_openai : cfg?.models) ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="__custom">自定义…</option>
            </select>
            <input data-testid="ai-config-model" value={modelSel} onChange={(e) => setModelSel(e.target.value)}
              style={{ width: 170, fontSize: 12 }} title="模型 id(下拉即填;可手改)" />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>接口 URL
            <input data-testid="ai-config-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={providerSel === 'openai'
                ? '如 https://api.deepseek.com/v1 · https://api.openai.com/v1 · Gemini 的 openai 兼容端点'
                : '默认 https://api.anthropic.com'}
              title="API key 会发送到此地址——只填官方或你信任的端点;留空 = 该供应商官方默认"
              style={{ flex: 1, minWidth: 200, fontSize: 12 }} autoComplete="off" />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>API key
            <input data-testid="ai-config-key" type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
              placeholder={cfg?.api_key_set ? `${cfg.api_key_hint || '已设置'}(输入以更换,留空不动)` : '未设置——粘贴 sk-ant-…'}
              style={{ flex: 1, minWidth: 160, fontSize: 12 }} autoComplete="off" />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button data-testid="ai-config-save" className="psa-btn psa-btn--dark" disabled={busy} onClick={() => void save()}>保存</button>
            {msg && <span style={{ fontSize: 11, color: 'var(--psa-faint)' }}>{msg}</span>}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--psa-faint)' }}>
            密钥存本地 data/ai_config.json(0600,已 gitignore),不入版本库/审计,界面永不回显原文。
          </div>
        </div>
      )}
    </div>
  )
}

export function AiDraftPanel({
  goal,
  mode,
  targetEtaName,
  targetFeId,
  targetFeLabel,
  functionalEvents,
  draft,
  busy,
  error,
  onGoalChange,
  onModeChange,
  onTargetFeIdChange,
  onGenerate,
  onApply,
  onClose,
  images = [],
  onAddImages,
  onRemoveImage,
  elements = [],
  acceptedIds = [],
  onToggleElement,
}: AiDraftPanelProps) {
  const warnings = draft ? [...(draft.warnings ?? []), ...(draft.validation?.warnings ?? [])] : []
  const errors = draft?.validation?.errors ?? []
  const etaCount = draft?.etas?.length ?? 0
  const ftCount = draft?.fts?.fault_trees?.length ?? 0
  const etaNames = draft ? etaNamesFromDraft(draft) : []
  const ftNames = draft ? ftNamesFromDraft(draft) : []
  const targetFe = functionalEvents.find((fe) => fe.id === targetFeId)
  const resolvedTargetFeLabel = targetFeLabel || targetFe?.label || targetFeId || '未选择屏障'
  const resolvedTargetEtaName = targetEtaName || '当前 ETA'
  const hasExpectedContent = !draft
    ? false
    : mode === 'fta_for_barrier' || mode === 'standalone_fta'
      ? ftCount > 0
      : etaCount > 0
  const accepted = new Set(acceptedIds)
  const canApply = !!draft?.validation?.ok && hasExpectedContent
    && (elements.length === 0 || acceptedIds.length > 0)
  const prov = draft?.provenance

  return (
    <section style={panel}>
      <div style={head}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon name="bolt" size={15} />
          <span style={title}>AI 建模助手</span>
          {draft && (
            <span style={draft.validation.ok ? okPill : errPill}>
              {draft.validation.ok ? '可应用草案' : '仅供审阅'}
            </span>
          )}
        </div>
        <button className="psa-btn" onClick={onClose} title="关闭" style={{ width: 30, padding: 0, justifyContent: 'center' }}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <div style={body}>
        <div style={left}>
          <div style={segmented} role="tablist" aria-label="AI 建模动作">
            {modeOptions.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                style={segBtn(mode === opt.mode)}
                onClick={() => onModeChange(opt.mode)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {mode === 'fta_for_barrier' && (
            <select value={targetFeId} onChange={(e) => onTargetFeIdChange(e.target.value)} style={select}>
              {functionalEvents.map((fe) => <option key={fe.id} value={fe.id}>{fe.label || fe.id}</option>)}
            </select>
          )}
          <textarea
            onPaste={(e) => {
              if (!onAddImages) return
              const files = [...e.clipboardData.items].filter((it) => it.type.startsWith('image/'))
                .map((it) => it.getAsFile()).filter((f): f is File => !!f)
              if (files.length) { e.preventDefault(); onAddImages(files) }
            }}
            value={goal}
            onChange={(e) => onGoalChange(e.target.value)}
            placeholder="例如: 电池舱液冷泄漏导致外短"
            style={textarea}
          />
          {images.length > 0 && (
            <div data-testid="ai-image-thumbs" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
              {images.map((im, i) => (
                <span key={i} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--psa-line)', borderRadius: 6, padding: 3 }}>
                  <img src={`data:${im.media_type};base64,${im.data}`} alt={im.name} style={{ height: 44, borderRadius: 4, display: 'block' }} />
                  <span style={{ fontSize: 10, color: 'var(--psa-faint)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{im.name}</span>
                  {onRemoveImage && (
                    <button data-testid={`ai-image-rm-${i}`} onClick={() => onRemoveImage(i)} title="移除"
                      style={{ border: 0, background: 'none', color: 'var(--psa-danger)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>✕</button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {onAddImages && (
              <label className="psa-btn" style={{ cursor: 'pointer' }} title="上传 ETA/FTA 截图(任意工具的图,≤3 张)——AI 转录为可编辑模型;数值照抄,看不清不编造。也可直接粘贴到目标输入框。">
                ＋截图(可选)
                <input data-testid="ai-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) onAddImages(fs); e.currentTarget.value = '' }} />
              </label>
            )}
            <button className="psa-btn psa-btn--primary" onClick={onGenerate} disabled={busy || !goal.trim()}>
              <Icon name="bolt" size={14} />{busy ? '生成中...' : '生成草案'}
            </button>
            <button className={canApply ? 'psa-btn psa-btn--primary' : 'psa-btn'} onClick={onApply} disabled={!canApply}>
              <Icon name="check" size={14} />应用草案
            </button>
            {error && <span style={errorText}>{error}</span>}
          </div>
          <AiConfigSection />
        </div>

        <div style={right}>
          {!draft ? (
            <div style={busy ? progressBox : emptyText}>
              {busy ? (
                <>
                  <strong>正在生成 AI 草案</strong>
                  <span>返回后将在这里显示 ETA/FTA 预览、应用去向和校验结果。</span>
                </>
              ) : '暂无草案'}
            </div>
          ) : (
            <>
              <div style={summary}>
                <strong>{draft.summary || 'AI 草案'}</strong>
                {namesFromDraft(draft).length > 0 && (
                  <span style={{ color: 'var(--psa-faint)' }}>{namesFromDraft(draft).join(' / ')}</span>
                )}
              </div>
              <div style={contentHint}>
                <span style={blockTitle}>草案内容</span>
                <span style={miniPill}>ETA {etaCount}</span>
                <span style={miniPill}>FTA {ftCount}</span>
                <span style={{ color: hasExpectedContent ? 'var(--psa-muted)' : 'var(--psa-danger)', minWidth: 0 }}>
                  {mode === 'fta_for_barrier'
                    ? (ftCount > 0
                      ? `将挂载到屏障: ${resolvedTargetFeLabel}（ETA: ${resolvedTargetEtaName}）`
                      : '未返回 FTA,无法应用到屏障')
                    : mode === 'complete_eta'
                      ? (etaCount > 0 ? '将补全并切换当前 ETA' : '未返回 ETA,无法补全当前 ETA')
                      : (etaCount > 0 ? '将新增 ETA 页签并自动切换显示' : '未返回 ETA,无法新增页签')}
                </span>
              </div>
              <div style={previewBox}>
                <PreviewLine label="ETA 草案" value={etaCount > 0 ? firstName(etaNames, '未命名 ETA') : '未返回 ETA'} muted={etaCount === 0} />
                <PreviewLine label="FTA 草案" value={ftCount > 0 ? firstName(ftNames, '未命名 FTA') : '未返回 FTA'} muted={ftCount === 0} />
                <div style={destinationBox}>
                  {mode === 'fta_for_barrier'
                    ? (ftCount > 0 ? `应用后将打开 FTA: ${firstName(ftNames, targetFeId || 'AI_FTA')}，挂载到屏障: ${resolvedTargetFeLabel}（ETA: ${resolvedTargetEtaName}）` : '应用前需要返回至少一个 FTA 草案。')
                    : mode === 'standalone_fta'
                      ? (ftCount > 0 ? `应用后将打开自建 FTA: ${firstName(ftNames, 'AI_FTA')}` : '应用前需要返回至少一个 FTA 草案。')
                      : mode === 'complete_eta'
                        ? (etaCount > 0 ? `应用后将补全并切换到当前 ETA: ${firstName(etaNames, 'AI ETA')}` : '应用前需要返回至少一个 ETA 草案。')
                        : (etaCount > 0 ? `应用后将新增并切换到 ETA 页签: ${firstName(etaNames, 'AI ETA')}` : '应用前需要返回至少一个 ETA 草案。')}
                </div>
              </div>
              {/* D7 ghost-diff:逐元素接受清单(虚线幽灵样式;取消勾选 = 该元素不落地) */}
              {elements.length > 0 && onToggleElement && (
                <div style={ghostBox}>
                  <div style={ghostHead}>
                    草案元素(逐个接受)
                    <span style={{ marginLeft: 'auto', fontWeight: 400, color: 'var(--psa-faint)' }}>
                      {acceptedIds.length}/{elements.length} 已接受
                    </span>
                  </div>
                  {elements.map((el) => {
                    const on = accepted.has(el.id)
                    const parentOff = el.parent ? !accepted.has(el.parent) : false
                    return (
                      <label key={el.id} style={{ ...ghostRow(on), marginLeft: el.parent ? 18 : 0, opacity: parentOff ? 0.35 : on ? 1 : 0.55 }}>
                        <input type="checkbox" checked={on} disabled={parentOff}
                          onChange={() => onToggleElement(el.id)} />
                        <span style={ghostKind}>{el.kind === 'eta' ? 'ETA' : el.kind === 'barrier' ? '屏障' : 'FTA'}</span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{el.label}</span>
                        {el.detail && <span style={{ marginLeft: 'auto', fontFamily: 'var(--psa-font-mono)', fontSize: 10.5, color: 'var(--psa-faint)', flexShrink: 0 }}>{el.detail}</span>}
                      </label>
                    )
                  })}
                </div>
              )}
              {prov && (
                <div style={provLine} title="AI 生成溯源(记入 ai_drafts 表与审计)">
                  溯源:{prov.model_id ?? '—'}{prov.served_by && prov.served_by !== prov.model_id ? ` → ${prov.served_by}(服务端回退)` : ''}
                  {prov.prompt_version ? ` · 提示词 ${prov.prompt_version}` : ''}
                  {prov.rounds ? ` · ${prov.rounds} 轮` : ''}
                  {prov.tool_trace?.length ? ` · 工具 ${prov.tool_trace.length} 次` : ''}
                </div>
              )}
              <ReadOnlyDraftPreview draft={draft} />
              {errors.length > 0 && <ListBlock title="校验错误" items={errors} tone="danger" />}
              {draft.assumptions?.length > 0 && <ListBlock title="假设" items={draft.assumptions} />}
              {draft.questions?.length > 0 && <ListBlock title="缺失数据" items={draft.questions} />}
              {warnings.length > 0 && <ListBlock title="风险提示" items={warnings} tone="warn" />}
              {draft.traceability?.length > 0 && (
                <ListBlock title="引用" items={draft.traceability.map(recordLine)} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function ReadOnlyDraftPreview({ draft }: { draft: AiDraftResponse }) {
  const eta = draft.etas?.[0]
  const ft = draft.fts?.fault_trees?.[0]
  if (!eta && !ft) return null
  return (
    <div style={readOnlyPreview}>
      <div style={blockTitle}>只读结构预览</div>
      {eta && (
        <div style={previewSection}>
          <div style={previewSectionTitle}>ETA</div>
          <ul style={previewList}>
            {etaPreviewLines(eta).map((line, idx) => <li key={`eta-${idx}`}>{line}</li>)}
          </ul>
        </div>
      )}
      {ft && (
        <div style={previewSection}>
          <div style={previewSectionTitle}>FTA</div>
          <ul style={previewList}>
            {ftaPreviewLines(ft).map((line, idx) => <li key={`fta-${idx}`}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function etaPreviewLines(eta: AiDraftResponse['etas'][number]): string[] {
  const model = eta.model
  const lines = [
    `名称: ${eta.name || model?.initEvent || eta.key || '未命名 ETA'}`,
    `初始事件: ${model?.initEvent || '未命名初始事件'}`,
    `初因频率: ${model?.initFreq ?? '未给出'}`,
  ]
  for (const fe of model?.functionalEvents ?? []) {
    lines.push(`屏障: ${fe.label || fe.id} (${fe.id}), PFD=${fe.failProb}`)
  }
  lines.push(...etaNodePreviewLines(model?.root, model?.functionalEvents ?? []))
  return lines
}

function etaNodePreviewLines(node: AiDraftResponse['etas'][number]['model']['root'] | undefined, fes: FuncEvent[], depth = 0): string[] {
  if (!node) return ['事件树结构: 未返回 root']
  if (depth > 4) return ['...']
  if (node.kind === 'leaf') return [`后果 -> ${node.consequence}`]
  const fe = fes.find((item) => item.id === node.feId)
  const label = fe?.label || node.feId
  const success = node.success.kind === 'leaf'
    ? [`成功 -> ${node.success.consequence}`]
    : [`成功 -> ${labelBranch(node.success.feId, fes)}`, ...etaNodePreviewLines(node.success, fes, depth + 1).map((line) => `  ${line}`)]
  const failure = node.failure.kind === 'leaf'
    ? [`失败 -> ${node.failure.consequence}`]
    : [`失败 -> ${labelBranch(node.failure.feId, fes)}`, ...etaNodePreviewLines(node.failure, fes, depth + 1).map((line) => `  ${line}`)]
  return [`判定屏障: ${label} (${node.feId})`, ...success, ...failure]
}

function labelBranch(feId: string, fes: FuncEvent[]): string {
  const fe = fes.find((item) => item.id === feId)
  return fe ? `${fe.label || fe.id} (${fe.id})` : feId
}

function ftaPreviewLines(ft: AiDraftResponse['fts']['fault_trees'][number]): string[] {
  const lines = [`故障树: ${ft.name}`, `Top: ${ft.top}`]
  const nodes = ft.nodes ?? []
  for (const node of nodes.slice(0, 10)) {
    if (node.basic) {
      lines.push(`${node.id}: 基本事件 param=${node.param_ref ?? '未给出'}`)
    } else {
      lines.push(`${node.id}: ${(node.op ?? 'gate').toUpperCase()}(${(node.args ?? []).join(', ')})`)
    }
  }
  if (nodes.length > 10) lines.push(`... 另有 ${nodes.length - 10} 个节点`)
  return lines
}

function PreviewLine({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={previewLine}>
      <span style={{ color: 'var(--psa-muted)' }}>{label}</span>
      <strong style={{ color: muted ? 'var(--psa-faint)' : 'var(--psa-ink)' }}>{value}</strong>
    </div>
  )
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone?: 'danger' | 'warn' }) {
  const color = tone === 'danger' ? 'var(--psa-danger)' : tone === 'warn' ? 'var(--psa-amber)' : 'var(--psa-ink-2)'
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ ...blockTitle, color }}>{title}</div>
      <ul style={listStyle}>
        {items.map((item, idx) => <li key={idx}>{item}</li>)}
      </ul>
    </div>
  )
}

// D7 ghost 样式:虚线边 + 半透明 = "尚未落地"的视觉语言
const ghostBox: CSSProperties = { border: '1.5px dashed var(--psa-primary)', borderRadius: 8, padding: '8px 10px', background: 'var(--psa-primary-soft)', display: 'flex', flexDirection: 'column', gap: 4 }
const ghostHead: CSSProperties = { display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--psa-primary-strong)', marginBottom: 2 }
const ghostRow = (on: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--psa-ink)', cursor: 'pointer', padding: '3px 6px', borderRadius: 5, border: `1px dashed ${on ? 'rgba(37,99,235,.35)' : 'var(--psa-line-2)'}`, background: on ? 'rgba(255,255,255,.6)' : 'transparent', textDecoration: on ? 'none' : 'line-through' })
const ghostKind: CSSProperties = { flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--psa-primary-strong)', border: '1px solid rgba(37,99,235,.25)', borderRadius: 4, padding: '0 4px', background: 'var(--psa-surface)' }
const provLine: CSSProperties = { fontSize: 11, color: 'var(--psa-faint)', fontFamily: 'var(--psa-font-mono)', padding: '2px 2px 0' }

const panel: CSSProperties = {
  position: 'fixed',
  top: 66,
  right: 16,
  bottom: 40,
  width: 'min(980px, calc(100vw - 32px))',
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--psa-surface)',
  border: '1px solid var(--psa-line-2)',
  borderRadius: 9,
  boxShadow: '0 18px 45px rgba(15,25,40,.22)',
  overflow: 'hidden',
}
const head: CSSProperties = {
  minHeight: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 14px',
  borderBottom: '1px solid var(--psa-line)',
}
const title: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--psa-ink)' }
const body: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 360px) minmax(0, 1fr)',
  gap: 14,
  padding: '10px 14px 12px',
  overflow: 'hidden',
}
const left: CSSProperties = { minHeight: 0, display: 'grid', gap: 8, alignContent: 'start', overflowY: 'auto', paddingRight: 2 }
const right: CSSProperties = { minWidth: 0, minHeight: 0, display: 'grid', gap: 8, alignContent: 'start', overflowY: 'auto', paddingRight: 4 }
const segmented: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 3,
  padding: 3,
  border: '1px solid var(--psa-line-strong)',
  borderRadius: 7,
  background: 'var(--psa-soft)',
}
const segBtn = (active: boolean): CSSProperties => ({
  minHeight: 26,
  border: 0,
  borderRadius: 5,
  padding: '0 9px',
  background: active ? 'var(--psa-primary)' : 'transparent',
  color: active ? '#fff' : 'var(--psa-ink-2)',
  fontSize: 12,
  cursor: 'pointer',
})
const select: CSSProperties = {
  height: 30,
  border: '1px solid var(--psa-line-strong)',
  borderRadius: 7,
  padding: '0 8px',
  fontSize: 12.5,
  color: 'var(--psa-ink)',
  background: 'var(--psa-surface)',
}
const textarea: CSSProperties = {
  width: '100%',
  minHeight: 74,
  resize: 'vertical',
  border: '1px solid var(--psa-line-strong)',
  borderRadius: 7,
  padding: '8px 10px',
  fontSize: 12.5,
  lineHeight: 1.45,
  color: 'var(--psa-ink)',
  background: 'var(--psa-surface)',
  boxSizing: 'border-box',
}
const summary: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  fontSize: 12.5,
  color: 'var(--psa-ink)',
}
const contentHint: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  minWidth: 0,
  fontSize: 11.5,
  lineHeight: 1.4,
}
const blockTitle: CSSProperties = { fontSize: 11.5, fontWeight: 700 }
const miniPill: CSSProperties = {
  border: '1px solid var(--psa-line-strong)',
  borderRadius: 5,
  padding: '1px 6px',
  color: 'var(--psa-ink-2)',
  background: 'var(--psa-soft)',
  fontSize: 11,
  fontFamily: 'var(--psa-font-mono)',
}
const listStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--psa-ink-2)',
  fontSize: 12,
  lineHeight: 1.45,
}
const progressBox: CSSProperties = {
  display: 'grid',
  gap: 4,
  color: 'var(--psa-ink-2)',
  fontSize: 12.5,
  padding: '8px 10px',
  border: '1px solid var(--psa-line)',
  borderRadius: 7,
  background: 'var(--psa-soft)',
}
const previewBox: CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: '7px 9px',
  border: '1px solid var(--psa-line)',
  borderRadius: 7,
  background: 'var(--psa-bg)',
}
const readOnlyPreview: CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: '8px 10px',
  border: '1px solid var(--psa-line)',
  borderRadius: 7,
  background: 'var(--psa-surface)',
}
const previewSection: CSSProperties = {
  display: 'grid',
  gap: 3,
  minWidth: 0,
}
const previewSectionTitle: CSSProperties = {
  color: 'var(--psa-primary-strong)',
  fontSize: 11.5,
  fontWeight: 700,
}
const previewList: CSSProperties = {
  margin: 0,
  paddingLeft: 17,
  color: 'var(--psa-ink-2)',
  fontSize: 11.5,
  lineHeight: 1.42,
  userSelect: 'text',
}
const previewLine: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px minmax(0, 1fr)',
  gap: 8,
  alignItems: 'center',
  minWidth: 0,
  fontSize: 12,
}
const destinationBox: CSSProperties = {
  marginTop: 2,
  paddingTop: 6,
  borderTop: '1px solid var(--psa-line)',
  color: 'var(--psa-primary-strong)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
}
const okPill: CSSProperties = {
  borderRadius: 999,
  padding: '2px 7px',
  fontSize: 11,
  color: 'var(--psa-ok)',
  background: 'rgba(22,163,74,.1)',
  border: '1px solid rgba(22,163,74,.22)',
}
const errPill: CSSProperties = {
  ...okPill,
  color: 'var(--psa-danger)',
  background: 'var(--psa-danger-soft)',
  border: '1px solid rgba(220,38,38,.18)',
}
const errorText: CSSProperties = { color: 'var(--psa-danger)', fontSize: 12, lineHeight: 1.35 }
const emptyText: CSSProperties = { color: 'var(--psa-faint)', fontSize: 12.5, padding: '8px 0' }
