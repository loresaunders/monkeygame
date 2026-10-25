import { chromium } from 'playwright'

const url = process.env.GAME_URL || 'http://127.0.0.1:43217/'

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.click('#start-btn')
await page.waitForTimeout(300)

const snap = () =>
  page.evaluate(() => {
    const g = window.__monkeyGame
    const p = g.getPlayerPosition()
    return {
      x: p.x,
      z: p.z,
      started: g.isStarted(),
      startVisible: g.isStartScreenVisible(),
      angles: g.getLookAngles(),
    }
  })

const before = await snap()
await page.evaluate(() => {
  const g = window.__monkeyGame
  g.debugHoldKey('KeyW', true)
  g.debugTick(60, 1 / 60) // 1 second of sim
  g.debugHoldKey('KeyW', false)
})
const afterWalk = await snap()
const dist = Math.hypot(afterWalk.x - before.x, afterWalk.z - before.z)

const beforeLook = afterWalk.angles
await page.evaluate(() => window.__monkeyGame.debugLook(180, 40))
const afterLook = await snap()
const lookChanged =
  Math.abs(afterLook.angles.yaw - beforeLook.yaw) > 0.05 ||
  Math.abs(afterLook.angles.pitch - beforeLook.pitch) > 0.02

// Keyboard event path: down, tick, up — proves listeners still work
const beforeKb = await snap()
await page.keyboard.down('KeyW')
await page.evaluate(() => window.__monkeyGame.debugTick(45, 1 / 60))
await page.keyboard.up('KeyW')
const afterKb = await snap()
const kbDist = Math.hypot(afterKb.x - beforeKb.x, afterKb.z - beforeKb.z)

const ok =
  dist > 5 &&
  kbDist > 4 &&
  lookChanged &&
  afterWalk.started &&
  !afterWalk.startVisible &&
  !afterLook.startVisible &&
  !afterKb.startVisible

console.log(
  JSON.stringify(
    {
      ok,
      dist: Number(dist.toFixed(2)),
      kbDist: Number(kbDist.toFixed(2)),
      lookChanged,
      before,
      afterWalk,
      afterLook,
      afterKb,
    },
    null,
    2,
  ),
)

await browser.close()
process.exit(ok ? 0 : 1)
