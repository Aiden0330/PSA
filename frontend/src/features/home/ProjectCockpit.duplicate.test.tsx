/** 复制项目按钮 UI 锁(规格 2026-07-29-project-duplicate §2):按钮在,prompt
 *  确认 → 店内成为新草稿(displayName=输入名,身份三清零);prompt 取消 → 不动。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectCockpit } from './ProjectCockpit'
import { resetProjectStore, useProjectStore } from '../../stores/projectStore'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

const persistence = {
  saved: [], savedId: '', projectUuid: '',
  onSaveWorkspace: () => {}, onDeleteSaved: () => {},
} as unknown as ProjectPersistence

describe('ProjectCockpit 复制项目按钮', () => {
  beforeEach(() => resetProjectStore())

  it('确认 prompt → duplicateActiveProject;取消 → 不动', async () => {
    useProjectStore.getState().setIdentity({ displayName: '源项目' })
    const srcWid = useProjectStore.getState().workspaceId
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      createRoot(host).render(
        <ProjectCockpit summaries={[]} aggregateTotals={{}} scenarios={[]}
          persistence={persistence} onOpenScenario={() => {}} />)
    })
    const btn = host.querySelector('[data-testid="duplicate-project"]') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)                       // 草稿也可复制
    // 取消:店不动
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    act(() => { btn.click() })
    expect(useProjectStore.getState().workspaceId).toBe(srcWid)
    // 确认:新草稿槽 + 身份三清零 + 新名
    vi.spyOn(window, 'prompt').mockReturnValueOnce('复制体甲')
    act(() => { btn.click() })
    const s = useProjectStore.getState()
    expect(s.workspaceId).not.toBe(srcWid)
    expect(s.identity).toEqual({ savedId: '', projectUuid: '', displayName: '复制体甲' })
    expect(s.parked[srcWid]?.identity.displayName).toBe('源项目')
  })
})
