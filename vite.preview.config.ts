import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 순수 브라우저에서 렌더러 UI만 미리보기 위한 독립 Vite 설정.
// (Electron 없이 window.api 미존재 → mockData 폴백으로 화면이 채워짐)
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  server: {
    port: 5199
  }
})
