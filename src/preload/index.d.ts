import type { SoundLibApi } from './index'

declare global {
  interface Window {
    api: SoundLibApi
  }
}
