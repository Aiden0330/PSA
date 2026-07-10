import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 便于 FastAPI 静态托管 dist;dev 时把 /api 代理到后端。
// 性能(2026-07-09 新窗口加载报障):
// - optimizeDeps.include:冷启动的 dev server 在启动时一次性预打包重依赖,
//   避免首个窗口触发 esbuild 优化 + 页中自动刷新(依赖变更后尤甚)。
// - singlefile 模式(npm run bundle):离线单文件必须内联动态分块(file:// 取不到分块);
//   常规 build(dist,:8000 托管)保留 React.lazy 产生的按需分块 —— ETA 关键路径不再
//   解析 reactflow/ag-grid/echarts。
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'dagre', 'reactflow',
              'ag-grid-community', 'ag-grid-react', 'echarts'],
  },
  build: mode === 'singlefile'
    ? { rollupOptions: { output: { inlineDynamicImports: true } }, chunkSizeWarningLimit: 4096 }
    : {},
}))
