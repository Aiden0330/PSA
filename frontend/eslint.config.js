import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import noStaleModelSet from './eslint-rules/no-stale-model-set.js'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    // 项目自有规则:模型写必须函数式 updater —— 本周"改动丢失"病根的机制性护栏
    // (2026-07-17 报障 → 45 处值式写全量整改;此规则防复发)。
    plugins: { psa: { rules: { 'no-stale-model-set': noStaleModelSet } } },
    rules: { 'psa/no-stale-model-set': 'error' },
  },
])
