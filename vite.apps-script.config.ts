import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({plugins:[react(),viteSingleFile()],build:{outDir:'.apps-script-build',emptyOutDir:true,assetsInlineLimit:1000000,rollupOptions:{output:{inlineDynamicImports:true}},chunkSizeWarningLimit:1200}});
