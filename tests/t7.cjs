/* Регресс-сьют фазы 4 (headless, software GL).
   Запуск: cd /home/user/Stars_Without_Numbers && LD_LIBRARY_PATH=/tmp/rootfs/usr/lib/x86_64-linux-gnu node tests/t7.js [--shots]
   --shots: снимки preview_phase4/ вместо assert-прогона.
   Watchdog: доступная RAM < 200M → SIGKILL браузеров (флаковая SwiftShader-утечка
   GPU-процесса headless-браузера, не баг сцены); в assert-режиме exit 3. */
const { chromium } = require('playwright-core')
const fs = require('fs')
const EXEC = '/home/user/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell'
const URL = 'http://localhost:5173/'
const SHOTS = process.argv.includes('--shots')
const LOG = SHOTS ? '/tmp/t7shots.log' : '/tmp/t7.log'
const out = (s) => { const line = `[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`; console.log(line); fs.appendFileSync(LOG, line + '\n') }
const T0 = Date.now()
fs.writeFileSync(LOG, '')

let browsers = []
let watchdogFired = false
const wd = setInterval(() => {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)
    const avail = m ? +m[1] / 1024 : 9999
    if (avail < 200) {
        watchdogFired = true
        out(`WATCHDOG avail=${Math.round(avail)}M — убиваю браузеры`)
        for (const b of browsers) { try { b.process() && b.process().kill('SIGKILL') } catch (e) {} }
        browsers = []
        if (!SHOTS) process.exit(3)
    }
}, 2000)

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; out(`PASS ${name}`) } else { fail++; out(`FAIL ${name} ${extra}`) }
}

async function openPage(vp = { width: 1280, height: 800 }) {
    const browser = await chromium.launch({
        executablePath: EXEC,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    })
    browsers.push(browser)
    const page = await browser.newPage({ viewport: vp })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(() => window.SWN && window.SWN.chart && window.SWN.chart.named().length > 0, null, { timeout: 90000 })
    await page.waitForTimeout(2500)   // первые кадры под software GL
    return { browser, page, errors }
}

const avail = () => { const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/); return m ? +m[1] / 1024 : 9999 }
const waitMem = async (need) => { for (let i = 0; i < 60 && avail() < need; i++) await new Promise((r) => setTimeout(r, 1500)) }

async function assertRun() {
    waitMem(900)   // тёплый старт: SwiftShader-прогрев съедает память разово
    // assert-прогону не нужен большой канвас: проверки DOM/API, а филл-рат
    // SwiftShader на 380k top-down дорогой — берём скромный viewport
    const { browser, page, errors } = await openPage({ width: 1000, height: 620 })
    const ev = (fn, ...a) => page.evaluate(fn, ...a)

    // ── геометрия/константы фазы 4 ──
    const g = await ev(() => ({
        bounds: SWN.chart.bounds.radius, sector: SWN.chart.sector,
        maxDist: SWN.rig.options.maxDist,
        dist: SWN.rig.dist, phi: SWN.rig.sph.phi,
        routes: SWN.chart.routeCount(),
        named: SWN.chart.named().length,
    }))
    ok('граница секторов = 200000', g.bounds === 200000, JSON.stringify(g))
    ok('шаг секторов 60000', g.sector === 60000)
    ok('maxDist 380000 (галактика целиком сверху)', g.maxDist === 380000)
    ok('старт: вся галактика сверху (dist 380k, phi≈0.18)', Math.abs(g.dist - 380000) < 2000 && g.phi < 0.3, JSON.stringify(g))
    ok('золотая сеть маршрутов построена', g.routes >= 3, 'routes=' + g.routes)

    const sc = await ev(() => {
        let unexp = false, links = false, routesOp = -1, ambient = null, uDim = -1
        let starOp = -1, starVis = false, panoOp = -1
        SWN.scene.traverse((o) => {
            if (o.name === 'unexplored-nodes') unexp = true
            if (o.name === 'links') links = true
            if (o.name === 'routes') routesOp = o.material.opacity
            if (o.name === 'stardome') { starOp = o.material.opacity; starVis = o.visible }
            if (o.isAmbientLight) ambient = o.intensity
            if (o.name === 'starfield') uDim = o.material.uniforms.uDim.value
            if (o.name === 'skybox') o.traverse((c) => { if (panoOp < 0 && c.isMesh && c.name !== 'stardome' && c.material && 'opacity' in c.material) panoOp = c.material.opacity })
        })
        return { panoOp, starOp, starVis, unexp, links, routesOp, ambient, uDim }
    })
    ok('на старте фон = 2k_stars (stardome op>0.9), панорама скрыта', sc.starOp > 0.9 && sc.starVis && sc.panoOp < 0.05, JSON.stringify(sc))
    ok('галактика приглушена на отдалении (uDim≈0.32)', Math.abs(sc.uDim - 0.32) < 0.05, 'uDim=' + sc.uDim)
    ok('маршруты видны на отдалении', sc.routesOp > 0.5, 'op=' + sc.routesOp)
    ok('точки необследованных УБРАНЫ', !sc.unexp)
    ok('паутина связей УБРАНА', !sc.links)
    ok('объект сети маршрутов в сцене', sc.routesOp >= 0)
    ok('ambient 1.15', Math.abs(sc.ambient - 1.15) < 1e-6, 'ambient=' + sc.ambient)

    // ── UI фазы 4 ──
    const ui = await ev(() => ({
        bm: !!document.querySelector('.app-bm'),
        homeBtn: document.querySelector('[data-act="home"]')?.textContent || '',
        bmButtons: document.querySelectorAll('button.bm').length,
    }))
    ok('панель закладок убрана', !ui.bm && ui.bmButtons === 0)
    ok('кнопка снизу = «Галактика»', /галактика/i.test(ui.homeBtn), ui.homeBtn)

    // ── фазa 5: пустой клик НЕ телепортирует к случайной звезде ──
    const dBefore = await ev(() => SWN.rig.dist)
    await page.mouse.click(80, 420)
    await page.waitForTimeout(1200)
    const mc = await ev(() => ({ state: SWN.interactor.state, dist: SWN.rig.dist, disp: document.querySelector('.ou-card')?.style.display }))
    ok('пустой клик не перемещает и не выбирает', mc.state === 'IDLE' && Math.abs(mc.dist - dBefore) < 1 && mc.disp !== 'block', JSON.stringify(mc))

    // ── скайфейд вблизи ──
    // ВАЖНО: только плавный перелёт. Мгновенный setState-телепорт 380k→200
    // кладёт SwiftShader-рендерер (soft-lock + лавина памяти) — проверено зондами
    await ev(() => SWN.rig.flyTo({ position: SWN.chart.named()[0].pos.clone(), dist: 200, duration: 2.2 }))
    await page.waitForFunction(() => SWN.rig.dist < 250, null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    const near = await ev(() => {
        let op = -1
        const sky = SWN.scene.getObjectByName('skybox')
        if (sky) sky.traverse((c) => { if (op < 0 && c.material && 'opacity' in c.material) op = c.material.opacity })
        return op
    })
    ok('вблизи системы фон = панорама GLB (op>0.8)', near > 0.8, 'op=' + near)
    const near2 = await ev(() => {
        let starOp = -1, routesOp = -1, routesVis = true, uDim = -1
        SWN.scene.traverse((o) => {
            if (o.name === 'stardome') starOp = o.material.opacity
            if (o.name === 'routes') { routesOp = o.material.opacity; routesVis = o.visible }
            if (o.name === 'starfield') uDim = o.material.uniforms.uDim.value
        })
        return { starOp, routesOp, routesVis, uDim }
    })
    ok('вблизи stardome скрыт', near2.starOp < 0.02, JSON.stringify(near2))
    ok('маршруты гаснут вблизи системы', near2.routesOp < 0.05 && !near2.routesVis, JSON.stringify(near2))
    ok('галактика яркая вблизи (uDim=1)', Math.abs(near2.uDim - 1) < 1e-6)

        // ── карточка, смещение влево, режим-кнопка ──
    const px = await ev(() => {
        const s = SWN.chart.named()[0]
        const v = s.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
        return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]
    })
    await ev((p) => SWN.interactor.selectAt(p[0], p[1]), px)
    await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
    await page.waitForTimeout(1200)
    const card = await ev(() => {
        const c = document.querySelector('.ou-card')
        const s = SWN.chart.named()[0]
        const v = s.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
        const r = c ? c.getBoundingClientRect() : null
        return {
            display: c ? c.style.display : 'missing',
            ndcX: +v.x.toFixed(3),
            cardLeft: r ? r.left / innerWidth : -1,
            modeBtn: !!(c && c.querySelector('.ou-mode')),
            offset: SWN.rig.options.focusOffset,
        }
    })
    const cardDist = await ev(() => SWN.rig.dist)
    ok('карточка открывается кликом', card.display === 'block', JSON.stringify(card))
    ok('объект левее центра (ndc x ≈ -0.3)', card.ndcX < -0.1 && card.ndcX > -0.6, 'ndcX=' + card.ndcX)
    const span = await ev(() => SWN.chart.named()[0].sys.span)
    ok('клик по системе вписывает ВСЮ систему (dist≥span·1.5)', cardDist >= span * 1.5, `dist=${cardDist} span=${span}`)
    ok('карточка справа не перекрывает объект', card.cardLeft > 0.6, 'left=' + card.cardLeft)
    ok('кнопка «объект/камера» УБРАНА', !card.modeBtn)
    ok('focusOffset включён', Math.abs(card.offset - 0.3) < 1e-6)

    // software GL даёт 1-2 FPS: держим клавишу дольше кадра, иначе ввод
    // «проскочит» между обновлениями рига
    const readAfter = () => ev(() => ({
        display: document.querySelector('.ou-card')?.style.display,
        offset: SWN.rig.options.focusOffset,
        state: SWN.interactor.state,
    }))
    let after = null
    for (let tryN = 0; tryN < 2; tryN++) {
        await page.keyboard.down('w')   // движение закрывает карточку (фаза 3)
        await page.waitForTimeout(1200)
        await page.keyboard.up('w')
        await page.waitForTimeout(1200)
        after = await readAfter()
        if (after.display === 'none') break
    }
    ok('движение (W) закрывает карточку', after.display === 'none', JSON.stringify(after))
    ok('focusOffset сброшен', after.offset === 0)

    // ── кнопка «Галактика» возвращает стартовый вид ──
    await ev(() => document.querySelector('[data-act="home"]').click())
    await page.waitForFunction(() => Math.abs(SWN.rig.dist - 380000) < 500 && SWN.rig.sph.phi < 0.3, null, { timeout: 90000 })
    ok('«Галактика» возвращает вид сверху на всю галактику', true)

    // ── фаза 5: камера не выходит за границу секторов (баг ПКМ) ──
    await ev(() => SWN.rig.flyTo({ position: new SWN.THREE.Vector3(190000, 0, 0), dist: 380000, phi: Math.PI / 2, duration: 1.2 }))
    await page.waitForFunction(() => SWN.rig.dist > 300000, null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    const camR = await ev(() => {
        const s = SWN.camera.position.clone().add(SWN.rig.originShift)
        return Math.hypot(s.x, s.z)
    })
    ok('камера не выходит за границу (R≤200000)', camR <= 200001, 'R=' + Math.round(camR))

    // ── addSystem + перестройка сети ──
    const r0 = g.routes
    const added = await ev(() => {
        const before = SWN.chart.routeCount()
        SWN.chart.addSystem({ name: 'Тестовая', auto: 'edge', star: 'sun' })
        return { before, after: SWN.chart.routeCount(), named: SWN.chart.named().length }
    })
    ok('addSystem добавляет систему и перестраивает сеть', added.named === g.named + 1 && added.after >= added.before, JSON.stringify(added))

ok('консоль чистая', errors.length === 0, errors.slice(0, 3).join(' | '))
    await browser.close()
    out(`ИТОГ: ${pass} PASS / ${fail} FAIL`)
    process.exit(fail ? 1 : 0)
}

async function shotsRun() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        waitMem(950)
        out(`попытка ${attempt}, avail=${Math.round(avail())}M`)
        let browser = null
        try {
            const r = await openPage()
            browser = r.browser
            const page = r.page
            fs.mkdirSync('/home/user/preview_phase4', { recursive: true })
            out('ready — обзор из boot-состояния (0 прыжков)')
            await page.screenshot({ path: '/home/user/preview_phase4/overview.png', timeout: 120000, animations: 'disabled' })
            out('overview готов')
            await page.evaluate(() => {
                const s = SWN.chart.named()[0]
                SWN.rig.flyTo({ position: s.pos.clone(), dist: 70, theta: 1.1, phi: 1.3, duration: 2.5 })
            })
            await page.waitForFunction(() => SWN.rig.dist < 90, null, { timeout: 60000 })
            await page.waitForTimeout(3000)
            await page.screenshot({ path: '/home/user/preview_phase4/closeup.png', timeout: 120000, animations: 'disabled' })
            out('closeup готов')
            const px = await page.evaluate(() => {
                const s = SWN.chart.named()[0]
                const v = s.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
                return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]
            })
            await page.evaluate((p) => SWN.interactor.selectAt(p[0], p[1]), px)
            await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
            await page.waitForTimeout(2500)
            await page.screenshot({ path: '/home/user/preview_phase4/card.png', timeout: 120000, animations: 'disabled' })
            out('card готов')
            await browser.close()
            out('все снимки готовы')
            return
        } catch (e) {
            out('попытка ' + attempt + ' ошибка: ' + String(e).slice(0, 200))
            if (browser) { try { browser.process() && browser.process().kill('SIGKILL') } catch (e2) {} }
        }
    }
    process.exit(1)
}

;(async () => {
    try { SHOTS ? await shotsRun() : await assertRun() }
    finally { clearInterval(wd); if (watchdogFired && !SHOTS) process.exit(3) }
})()
