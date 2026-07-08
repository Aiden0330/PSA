import { defineConfig } from 'vitest/config'

// 独立配置: 测试用 jsdom 环境(提供 localStorage / crypto 全局)
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
