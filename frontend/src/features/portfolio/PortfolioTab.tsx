import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { listProjects } from '../../api'
import type { ProjectInfo } from '../../api'
import type { ProjectPersistence } from '../persistence/useProjectPersistence'

/**
 * 多项目组合总览(R3 骨架;R5 接 /api/portfolio 换成按钉扎案例的风险数字 + 组合矩阵 + 评审队列)。
 * 现阶段:项目库列表(uuid/名/版本数),点击一行 = 打开该项目对应存档(若存在)。
 */
export function PortfolioTab({ persistence }: { persistence: ProjectPersistence }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { listProjects().then(setProjects).catch((e) => setErr(String(e?.message ?? e))) }, [])

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--exp-bg)', padding: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--exp-ink)', marginBottom: 4 }}>多项目组合总览</div>
      <div style={{ fontSize: 11.5, color: 'var(--exp-muted)', marginBottom: 12 }}>
        项目库(共 {projects.length} 个)。R5 将把风险数字换成取自钉扎分析案例的值(案例# · 版本哈希)+ 组合风险矩阵 + 评审队列。
      </div>
      {err && <div style={{ marginBottom: 10, padding: 8, background: 'var(--psa-danger-soft)', color: 'var(--psa-danger-strong)', borderRadius: 6, fontSize: 12 }}>{err}</div>}
      <div className="psa-panel" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: 'var(--exp-soft)', textAlign: 'left' }}>
              {['项目', '版本数', 'UUID', '最近修改'].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.uuid} style={{ borderTop: '1px solid var(--exp-line)' }}>
                <td style={td}><b>{p.name}</b></td>
                <td style={{ ...td, fontFamily: 'var(--psa-font-mono)' }}>{p.versions}</td>
                <td style={{ ...td, fontFamily: 'var(--psa-font-mono)', color: 'var(--exp-faint)' }}>{p.uuid.slice(0, 8)}</td>
                <td style={{ ...td, fontFamily: 'var(--psa-font-mono)', color: 'var(--exp-faint)' }}>{p.modified_at.slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
            {projects.length === 0 && !err && <tr><td colSpan={4} style={{ ...td, color: 'var(--exp-muted)' }}>暂无已保存项目(保存当前项目后在此出现)。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th: CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--exp-muted)', fontWeight: 600 }
const td: CSSProperties = { padding: '7px 10px' }
