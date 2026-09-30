import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * Конфигурация проекта.
 *
 * 1. `root: 'src'` — index.html лежит в src/, поэтому корень дев-сервера тоже там.
 *    В html подключаем `/map/main.js` (→ src/map/main.js) и `/styles.css` (→ src/styles.css).
 *
 * 2. `publicDir: '../public'` — твоя папка с ассетами называется `public` и лежит
 *    В КОРНЕ репозитория. Vite по умолчанию ищет publicDir внутри root (src/public)
 *    и не находит её. С этой настройкой:
 *        public/planets/textures/Mars.jpg → http://localhost:5173/planets/textures/Mars.jpg
 *    То есть в коде пути пишутся БЕЗ префикса `public/` и через прямой слеш.
 *    Прежние 'public\\planets\\textures\\Pluto.jpg' в браузере не работали никогда:
 *    обратный слеш — не разделитель URL, это guaranteed 404.
 *
 * 3. `host: '0.0.0.0'` — чтобы открывать с телефона в той же сети.
 */
export default defineConfig({
    root: fileURLToPath(new URL('./src', import.meta.url)),
    publicDir: fileURLToPath(new URL('./public', import.meta.url)),
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: false,
        // Vite 6+ блокирует запросы с незнакомых Host-заголовков.
        // true = разрешить любой хост (для дев-сервера это нормально;
        // если хочется строже — впишите свой домен и '.e2b.app').
        allowedHosts: true,
    },
    preview: {
        host: '0.0.0.0',
        port: 4173,
    },
    build: {
        outDir: fileURLToPath(new URL('./dist', import.meta.url)),
        emptyOutDir: true,
        target: 'es2020',
    },
})
