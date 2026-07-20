import { defineConfig } from 'vitest/config'

// 独立配置: 测试用 jsdom 环境(提供 localStorage / crypto 全局)
export default defineConfig({
  // 与 vite.config 的 define 对齐:StatusBar 消费构建戳,测试环境给固定占位
  define: { __BUILD_TS__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
