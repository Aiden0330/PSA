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
  // 构建戳:状态栏可读,一眼判定标签页是否在跑旧代码(报障定位反复被"陈旧标签页"污染)
  define: { __BUILD_TS__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [react()],
  base: './',
  server: {
    // PSA_BACKEND:并行会话占用 :8000 时,备用 dev 实例可指向自己的后端(默认不变)
    proxy: { '/api': process.env.PSA_BACKEND ?? 'http://localhost:8000' },
  },
  // 生产预览(make app):构建产物 + 同款代理——日常使用毫秒级加载,
  // 无 dev 依赖预打包(dev 服务器每次重启后的首次访问都要重打包,20-30s 由此而来)
  preview: {
    port: 4173,
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
