import { defineConfig } from 'vite';
// base './' keeps file paths relative so the same build works on a website and inside the Android app.
export default defineConfig({ base: './', build: { outDir: 'dist', emptyOutDir: true } });
