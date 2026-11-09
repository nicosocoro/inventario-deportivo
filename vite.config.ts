import { defineConfig, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Un solo proyecto, dos sitios: `--mode ventas` (PWA) o `--mode admin`.
export default defineConfig(({ mode }) => {
  if (mode !== 'ventas' && mode !== 'admin') {
    throw new Error('Usar --mode ventas o --mode admin')
  }
  const plugins: PluginOption[] = [vue()]
  if (mode === 'ventas') {
    plugins.push(
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/*.png', 'icons/*.svg'],
        manifest: {
          name: 'Cantina CADB',
          short_name: 'Cantina',
          description: 'Ventas de la cantina del Club Atlético Deportivo Barreal',
          lang: 'es-AR',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          background_color: '#ffffff',
          theme_color: '#14532d',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          // jsPDF no se usa en el sitio ventas; si apareciera, no precachearlo.
          globIgnores: ['**/jspdf*', '**/html2canvas*'],
          cleanupOutdatedCaches: true,
        },
      }),
    )
  }
  return {
    root: r(`./src/app/${mode}`),
    envDir: r('.'),
    publicDir: r(`./public-${mode}`),
    plugins,
    build: { outDir: r(`./dist/${mode}`), emptyOutDir: true },
    server: { port: mode === 'ventas' ? 5173 : 5174 },
  }
})
