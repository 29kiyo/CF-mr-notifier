import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages のURLは https://29kiyo.github.io/CF-mr-notifier/ なのでサブパスを指定
export default defineConfig({
  base: '/CF-mr-notifier/',
  plugins: [react()],
});
