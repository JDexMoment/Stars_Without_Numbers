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
    ok('шаг секторов 10000 (квадраты 3×3 мельче)', g.sector === 10000)
    ok('maxDist 170000 (отдаление чуть больше)', g.maxDist === 170000)
    ok('старт: галактика сверху впритык (dist 148k, phi≈0.18)', Math.abs(g.dist - 148000) < 3000 && g.phi < 0.3, JSON.stringify(g))
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
    ok('на старте фон = 2k_stars (stardome op≈0.78), панорама скрыта', sc.starOp > 0.7 && sc.starVis && sc.panoOp < 0.05, JSON.stringify(sc))
    ok('галактика чуть приглушена на обзоре (uDim≈0.79)', Math.abs(sc.uDim - 0.79) < 0.08, 'uDim=' + sc.uDim)
    ok('маршруты видны на отдалении', sc.routesOp > 0.5, 'op=' + sc.routesOp)
    ok('точки необследованных УБРАНЫ', !sc.unexp)
    ok('паутина связей УБРАНА', !sc.links)
    ok('объект сети маршрутов в сцене', sc.routesOp >= 0)
    ok('ambient 0.9', Math.abs(sc.ambient - 0.9) < 1e-6, 'ambient=' + sc.ambient)

    // ── UI фазы 4 ──
    const ui = await ev(() => {
        const sec = document.querySelector('.app-sector')?.getBoundingClientRect()
        return {
            bm: !!document.querySelector('.app-bm'),
            homeBtn: document.querySelector('[data-act="home"]')?.textContent || '',
            bmButtons: document.querySelectorAll('button.bm').length,
            telem: !!document.querySelector('.rig-telemetry'),
            searchTop: Math.round(document.querySelector('.app-search').getBoundingClientRect().top),
            boundNdc: (() => { const v = new (SWN.camera.position.constructor)(SWN.chart.bounds.radius, 0, 0).sub(SWN.rig.originShift).project(SWN.camera); return +v.x.toFixed(2) })(),
            homeColor: getComputedStyle(document.querySelector('[data-act="home"]')).color,
            fineColor: getComputedStyle(document.querySelector('[data-act="fine"]')).color,
            secI: !!document.querySelector('.app-sector i:not(.rg)'),
            secTop: sec ? Math.round(sec.top) : -1,
            secRight: sec ? Math.round(innerWidth - sec.right) : -1,
            strip: document.querySelector('.rig-speed')?.getBoundingClientRect(),
            help: document.querySelector('.rig-help-btn')?.getBoundingClientRect(),
        }
    })
    ok('полоса скорости не наезжает на «?»', ui.strip && ui.help && ui.strip.right < ui.help.left - 4, JSON.stringify([ui.strip?.right, ui.help?.left]))
    ok('панель закладок убрана', !ui.bm && ui.bmButtons === 0)
    ok('кнопка снизу = «Галактика»', /галактика/i.test(ui.homeBtn), ui.homeBtn)
    ok('вкладка «Навигация» убрана', !ui.telem)
    ok('бейдж сектора: без живого счётчика', !ui.secI)
    ok('секторный бейдж справа сверху', ui.secTop >= 0 && ui.secTop < 60 && ui.secRight < 40, JSON.stringify(ui))
    ok('бейдж на одной высоте с поиском', Math.abs(ui.secTop - ui.searchTop) <= 2, `sec=${ui.secTop} search=${ui.searchTop}`)
    ok('граница галактики чуть не помещается в экран', Math.abs(ui.boundNdc) > 1, 'ndcX=' + ui.boundNdc)
    ok('кнопка «Галактика» не тусклее соседних', ui.homeColor === ui.fineColor, ui.homeColor + ' vs ' + ui.fineColor)
    // фаза 8: защёлки «Точно» / «Ускоритель»
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const latch1 = await ev(() => ({ on: document.querySelector('[data-act="fine"]').classList.contains('on'), fine: SWN.rig.fineOn }))
    await page.waitForTimeout(500)
    const latch2 = await ev(() => document.querySelector('[data-act="fine"]').classList.contains('on'))
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    const latch3 = await ev(() => SWN.rig.fineOn)
    ok('Space — защёлка: включилась и держится без удержания', latch1.on && latch1.fine && latch2 && !latch3, JSON.stringify([latch1, latch2, latch3]))
    await ev(() => document.querySelector('[data-act="boost"]').click())
    await page.waitForTimeout(300)
    const b1 = await ev(() => SWN.rig.boostOn)
    await ev(() => document.querySelector('[data-act="boost"]').click())
    await page.waitForTimeout(300)
    const b2 = await ev(() => SWN.rig.boostOn)
    ok('«Ускоритель» кнопкой — тоже защёлка', b1 && !b2)

    // ── фазa 5: пустой клик НЕ телепортирует к случайной звезде ──
    const dBefore = await ev(() => SWN.rig.dist)
    await page.mouse.click(80, 420)
    await page.waitForTimeout(1200)
    const mc = await ev(() => ({ state: SWN.interactor.state, dist: SWN.rig.dist, disp: document.querySelector('.ou-card')?.style.display }))
    ok('пустой клик не перемещает и не выбирает', mc.state === 'IDLE' && Math.abs(mc.dist - dBefore) < 1 && mc.disp !== 'block', JSON.stringify(mc))

    const skyFar = await ev(() => {
        const sd = SWN.scene.getObjectByName('stardome')
        const sb = SWN.scene.getObjectByName('skybox')
        return { sdVis: sd.visible, sbVis: sb.visible, sdOp: sd.material.opacity }
    })
    ok('вдали звёздное небо видно (не чёрный экран)', skyFar.sdVis && skyFar.sbVis && skyFar.sdOp > 0.7, JSON.stringify(skyFar))

    // ── фаза 6: клик по подписи системы на старте → вся система в кадре ──
    const labPx = await ev(() => {
        const s = SWN.chart.named()[0]
        const v = s.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
        return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]
    })
    await page.mouse.click(labPx[0], labPx[1] + 6)   // плашка подписи
    await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
    const sysDist = await ev(() => SWN.rig.dist)
    const span0 = await ev(() => SWN.chart.named()[0].sys.span)
    ok('клик по подписи: вся система в кадре (dist≥span·1.5)', sysDist >= span0 * 1.5, `dist=${Math.round(sysDist)} span=${span0}`)
    await page.waitForFunction(() => SWN.rig.dist < SWN.chart.named()[0].sys.span * 2.6, null, { timeout: 90000 })
    // фаза 7: клик по строке планеты в карточке → выбор + подлёт
    const nLi = await ev(() => document.querySelectorAll('.ou-card .ou-planets li[data-p]').length)
    ok('список планет кликабелен', nLi > 0, 'li=' + nLi)
    await ev(() => document.querySelector('.ou-card .ou-planets li[data-p="0"]').click())
    await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
    await page.waitForFunction(() => SWN.rig.dist < SWN.chart.named()[0].sys.span, null, { timeout: 60000 })
    const planetCard = await ev(() => ({
        title: document.querySelector('.ou-card h3')?.textContent,
        dist: Math.round(SWN.rig.dist),
        span: SWN.chart.named()[0].sys.span,
    }))
    ok('клик по планете из меню: подлёт к планете', planetCard.title !== 'Гелиос — звезда' && planetCard.dist < planetCard.span, JSON.stringify(planetCard))
    await page.keyboard.down('w'); await page.waitForTimeout(1200); await page.keyboard.up('w')
    await page.waitForTimeout(1200)

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
        let starOp = -1, routesOp = -1, routesVis = true, uDim = -1, panoOp = -1
        SWN.scene.traverse((o) => {
            if (o.name === 'stardome') starOp = o.material.opacity
            if (o.name === 'routes') { routesOp = o.material.opacity; routesVis = o.visible }
            if (o.name === 'starfield') uDim = o.material.uniforms.uDim.value
        })
        const sb = SWN.scene.getObjectByName('skybox')
        sb.traverse((m) => { if (m.isMesh && m.name !== 'stardome') panoOp = m.material.opacity })
        return { starOp, routesOp, routesVis, uDim, panoOp, sbVis: sb.visible }
    })
    ok('вблизи остаются звёзды (stardome op≈0.78)', near2.starOp >= 0.7, JSON.stringify(near2))
    ok('вблизи панорама видна и родитель не скрыт', near2.panoOp > 0.5, JSON.stringify(near2))
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
    // software GL 1-2 FPS: ждём НЕ по таймеру, а пока смещение влево реально
    // встанет (offCur сходится за несколько кадров)
    await page.waitForFunction(() => {
        const s = SWN.chart.named()[0]
        const v = s.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
        return v.x < -0.2
    }, null, { timeout: 60000 })
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
    // дождаться ПРИБытия: мерить dist посреди перелёта нельзя
    await page.waitForFunction(() => SWN.rig.dist < SWN.chart.named()[0].sys.span, null, { timeout: 60000 })
    const cardDist = await ev(() => SWN.rig.dist)
    ok('карточка открывается кликом', card.display === 'block', JSON.stringify(card))
    ok('объект левее центра (ndc x ≈ -0.3)', card.ndcX < -0.1 && card.ndcX > -0.6, 'ndcX=' + card.ndcX)
    const span = await ev(() => SWN.chart.named()[0].sys.span)
    ok('клик по самой звезде = приближение к звезде (dist<span)', cardDist < span, `dist=${Math.round(cardDist)} span=${span}`)
    // сворачивание: информация скрыта, объект остаётся выбранным
    await ev(() => document.querySelector('.ou-card [data-a="collapse"]').click())
    await page.waitForTimeout(500)
    const col = await ev(() => ({
        collapsed: document.querySelector('.ou-card').classList.contains('collapsed'),
        display: document.querySelector('.ou-card').style.display,
        state: SWN.interactor.state,
    }))
    ok('«Свернуть»: карточка свёрнута, объект выбран', col.collapsed && col.display === 'block' && col.state === 'FOLLOWING', JSON.stringify(col))
    ok('в свёрнутом виде есть стрелка «развернуть»', await ev(() => getComputedStyle(document.querySelector('.ou-chev')).display !== 'none'))
    await ev(() => document.querySelector('.ou-card .ou-head').click())
    await page.waitForTimeout(500)
    ok('клик по шапке раскрывает карточку', await ev(() => !document.querySelector('.ou-card').classList.contains('collapsed')))
    ok('стрелка скрывается после разворачивания', await ev(() => getComputedStyle(document.querySelector('.ou-chev')).display === 'none'))
    const badgeCard = await ev(() => {
        const bd = document.querySelector('.app-sector')
        const cd = document.querySelector('.ou-card').getBoundingClientRect()
        return { bHidden: getComputedStyle(bd).display === 'none', cRight: Math.round(innerWidth - cd.right), cTop: Math.round(cd.top) }
    })
    ok('при открытой карточке бейдж скрыт, карточка на его месте', badgeCard.bHidden && badgeCard.cRight <= 16 && badgeCard.cTop <= 20, JSON.stringify(badgeCard))
    const cardTop = await ev(() => Math.round(document.querySelector('.ou-card').getBoundingClientRect().top))
    ok('карточка на высоте поиска (top≤20)', cardTop <= 20, 'top=' + cardTop)
    const stripHidden = await ev(() => getComputedStyle(document.querySelector('.rig-speed')).opacity)
    ok('плашка скорости скрыта при выбранном объекте', stripHidden === '0', 'opacity=' + stripHidden)
    const acts = await ev(() => [...document.querySelectorAll('.ou-card .acts button')].map((b) => b.textContent))
    ok('кнопки: Ближе/Отдалить/Свернуть', acts.join(',') === 'Ближе,Отдалить,Свернуть', acts.join(','))
    ok('карточка не перекрывает объект', card.cardLeft > 0.44 && (card.ndcX * 0.5 + 0.5) < card.cardLeft - 0.03, JSON.stringify(card))
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
    // на 1-2 FPS нажатие может попасть МЕЖДУ редкими кадрами update —
    // поэтому держим W и повторяем, пока карточка не закроется (на 60 FPS хватит и раза)
    for (let tryN = 0; tryN < 4; tryN++) {
        await page.keyboard.down('w')   // движение закрывает карточку (фаза 3)
        await page.waitForTimeout(2000)
        await page.keyboard.up('w')
        await page.waitForFunction(() => document.querySelector('.ou-card').style.display === 'none', null, { timeout: 6000 }).catch(() => {})
        after = await readAfter()
        if (after.display === 'none') break
    }
    ok('движение (W) закрывает карточку', after.display === 'none', JSON.stringify(after))
    ok('focusOffset сброшен', after.offset === 0)
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.rig-speed')).opacity === '1', null, { timeout: 8000 })
    ok('плашка скорости вернулась после снятия выбора', true)

    // ── кнопка «Галактика» возвращает стартовый вид ──
    await ev(() => document.querySelector('[data-act="home"]').click())
    await page.waitForFunction(() => Math.abs(SWN.rig.dist - 148000) < 4000 && SWN.rig.sph.phi < 0.3, null, { timeout: 90000 })
    ok('«Галактика» возвращает вид сверху на всю галактику', true)

    // ── фаза 5: камера не выходит за границу секторов (баг ПКМ) ──
    await ev(() => SWN.rig.flyTo({ position: new SWN.THREE.Vector3(190000, 0, 0), dist: SWN.rig.options.maxDist, phi: Math.PI / 2, duration: 1.2 }))
    await page.waitForFunction(() => SWN.rig.dist > SWN.rig.options.maxDist * 0.85, null, { timeout: 60000 })
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

    // ── фаза 8/9: поиск по всей базе с тегами и цветами ──
    await page.fill('.app-search input', 'Плутон')
    await page.waitForSelector('.app-search .res button', { timeout: 15000 })
    const tags = await ev(() => [...document.querySelectorAll('.app-search .res .sq-tag')].map((t) => t.textContent))
    ok('поиск помечает строки тегами', tags.includes('планета'), tags.join(','))
    await page.fill('.app-search input', 'Гелиос')
    await page.waitForFunction(() => document.querySelectorAll('.app-search .res button').length >= 4, null, { timeout: 15000 })
    const tagColors = await ev(() => [...document.querySelectorAll('.app-search .res .sq-tag')].map((t) => getComputedStyle(t).color))
    ok('каждый класс в поиске — своего цвета', new Set(tagColors).size >= 2, tagColors.join(' | '))
    const chips = await ev(() => document.querySelectorAll('.app-search .res button .chip').length)
    ok('строки поиска с цветным чипом объекта', chips >= 2, 'chips=' + chips)
    await page.fill('.app-search input', 'узел 1')
    await page.waitForFunction(() => document.querySelector('.app-search .res .sq-tag')?.textContent === 'узел', null, { timeout: 15000 })
    ok('вся база: необследованные узлы тоже ищутся', (await ev(() => document.querySelector('.app-search .res .sq-tag')?.textContent)) === 'узел')
    await page.fill('.app-search input', 'Плутон')
    await page.waitForFunction(() => document.querySelector('.app-search .res .sq-tag')?.textContent === 'планета', null, { timeout: 15000 })
    await page.click('.app-search .res button')
    await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
    const found = await ev(() => document.querySelector('.ou-card h3')?.textContent)
    ok('поиск планеты: выбор и подлёт', /Плутон/i.test(found || ''), found)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    const secName = await ev(() => SWN.chart.sectors()[0])
    await page.fill('.app-search input', secName)
    await page.waitForFunction(() => [...document.querySelectorAll('.app-search .res .sq-tag')].some((t) => t.textContent === 'сектор'), null, { timeout: 15000 })
    ok('поиск секторов с тегом', true)
    await ev(() => { [...document.querySelectorAll('.app-search .res button')].find((b) => b.querySelector('.sq-tag')?.textContent === 'сектор').click() })
    await page.waitForFunction(() => SWN.rig.dist < SWN.chart.sectorSize * 2, null, { timeout: 60000 })
    const secRes = await ev(() => ({ d: SWN.rig.dist, ss: SWN.chart.sectorSize }))
    ok('перелёт к сектору из поиска', secRes.d > 500 && secRes.d < secRes.ss * 2.2, 'dist=' + Math.round(secRes.d))

    // ── фаза 10: 2D-план ──
    await ev(() => document.querySelector('[data-act="dim"]').click())
    await page.waitForFunction(() => SWN.rig.mode2d === true, null, { timeout: 15000 })
    await page.waitForFunction(() => SWN.rig.sph.phi < 0.1, null, { timeout: 60000 })
    const twoD = await ev(() => ({
        gold: !!SWN.scene.getObjectByName('galaxyOutline'),
        marks: SWN.scene.getObjectByName('markers2d-sys')?.visible || false,
        plFar: SWN.scene.getObjectByName('markers2d-pl')?.visible || false,
        sky: SWN.scene.getObjectByName('skybox')?.visible,
        btn: document.querySelector('[data-act="dim"]').textContent,
    }))
    ok('2D: маркеры видны, небо скрыто, золотой подложки нет', twoD.marks && twoD.sky === false && twoD.gold === false, JSON.stringify(twoD))
    // фаза 11: отдалиться в плане — планеты обязаны скрыться (не сыпать пикселями)
    await ev(() => SWN.rig.flyTo({ dist: 120000, duration: 1.2 }))
    await page.waitForFunction(() => SWN.rig.dist > 60000, null, { timeout: 60000 })
    await page.waitForTimeout(900)
    const plFar2 = await ev(() => SWN.scene.getObjectByName('markers2d-pl')?.visible || false)
    ok('2D: планеты с высоты не сыплют пикселями (маркеры скрыты)', plFar2 === false, 'plFar=' + plFar2)
    // фаза 11: при подлёте в плане появляются планеты на волосяных орбитах
    await ev(() => { SWN.rig.flyTo({ dist: 15000, duration: 1.5 }) })
    await page.waitForFunction(() => SWN.rig.dist < 20000, null, { timeout: 30000 })
    await page.waitForTimeout(1200)
    const plNear = await ev(() => ({
        pl: SWN.scene.getObjectByName('markers2d-pl')?.visible || false,
        orb: SWN.scene.getObjectByName('markers2d-orb')?.visible || false,
    }))
    ok('2D: вблизи системы видны планеты и их орбиты', plNear.pl && plNear.orb, JSON.stringify(plNear))
    ok('2D: кнопка переключилась на «Объём · 3D»', /3D/.test(twoD.btn), twoD.btn)
    const mPx = await ev(() => {
        const sys = SWN.chart.systems[0]
        const v = sys.pos.clone().sub(SWN.rig.originShift).project(SWN.camera)
        return [(v.x*.5+.5)*innerWidth, (-v.y*.5+.5)*innerHeight]
    })
    await ev((p) => SWN.interactor.selectAt(p[0], p[1]), mPx)
    await page.waitForTimeout(1500)
    const card2d = await ev(() => ({
        display: document.querySelector('.ou-card').style.display,
        acts: [...document.querySelectorAll('.ou-card .acts button')].map((b) => b.textContent).join(','),
    }))
    ok('2D: клик по маркеру открывает карточку с «В 3D»', card2d.display === 'block' && /В 3D/.test(card2d.acts), JSON.stringify(card2d))
    await ev(() => document.querySelector('.ou-card [data-a="to3d"]').click())
    await page.waitForFunction(() => SWN.rig.mode2d === false, null, { timeout: 15000 })
    await page.waitForFunction(() => SWN.interactor.state === 'FOLLOWING', null, { timeout: 90000 })
    ok('2D→3D: выход и перелёт к объекту', true)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

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
