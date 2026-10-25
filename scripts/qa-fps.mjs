import { chromium } from 'playwright'

const url = process.env.GAME_URL || 'http://127.0.0.1:43217/'
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.click('#start-btn')
await page.waitForTimeout(500)

const stats = await page.evaluate(async () => {
  const g = window.__monkeyGame
  const renderer = g.renderer
  const info = () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
  })

  // Warm
  for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r))

  const samples = []
  let last = performance.now()
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    samples.push(now - last)
    last = now
  }
  samples.sort((a, b) => a - b)
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  const p95 = samples[Math.floor(samples.length * 0.95)]

  // Rough scene inventory
  let meshes = 0
  let castShadow = 0
  let verts = 0
  g.scene.traverse((o) => {
    if (o.isMesh) {
      meshes++
      if (o.castShadow) castShadow++
      const geo = o.geometry
      if (geo?.attributes?.position) verts += geo.attributes.position.count
    }
  })

  return {
    fpsAvg: Number((1000 / avg).toFixed(1)),
    fpsP95: Number((1000 / p95).toFixed(1)),
    frameMsAvg: Number(avg.toFixed(2)),
    frameMsP95: Number(p95.toFixed(2)),
    render: info(),
    meshes,
    castShadow,
    verts,
    pixelRatio: renderer.getPixelRatio(),
    shadowMap: renderer.shadowMap.enabled,
  }
})

console.log(JSON.stringify(stats, null, 2))
await browser.close()
