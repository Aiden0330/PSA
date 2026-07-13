import { create } from 'zustand'
import { StatusError, getMe, login as apiLogin, logout as apiLogout } from '../api'
import type { Identity } from '../api'

/**
 * 认证态(不持久化 —— 身份以服务器会话 cookie 为准,本地不留副本)。
 * needsLogin 精确对应 getMe() 返回 401(参见 api.ts StatusError);网络不可达
 * (离线单文件/开发服务器未起)一律 needsLogin=false,退化为如同 off 模式(约束 #0)。
 */
export interface AuthState {
  identity: Identity | null
  status: 'loading' | 'ready'
  needsLogin: boolean
  loginError: string | null
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const initial = { identity: null as Identity | null, status: 'loading' as const, needsLogin: false, loginError: null as string | null }

export const useAuthStore = create<AuthState>((set) => ({
  ...initial,
  refresh: async () => {
    try {
      const identity = await getMe()
      set({ identity, status: 'ready', needsLogin: false })
    } catch (e) {
      const unauthenticated = e instanceof StatusError && e.status === 401
      set({ identity: null, status: 'ready', needsLogin: unauthenticated })
    }
  },
  login: async (username, password) => {
    set({ loginError: null })
    try {
      const identity = await apiLogin(username, password)
      set({ identity, needsLogin: false, loginError: null })
    } catch (e: any) {
      set({ loginError: String(e?.message ?? e) })
      throw e
    }
  },
  logout: async () => {
    try { await apiLogout() } catch { /* 登出尽力而为:无论如何都清本地身份 */ }
    set({ identity: null, needsLogin: true })
  },
}))

/** 测试用:回到初始态。 */
export function resetAuthStore() {
  useAuthStore.setState(initial)
}
