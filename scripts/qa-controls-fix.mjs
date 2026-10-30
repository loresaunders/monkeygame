/**
 * Verify O overdrive (real KeyboardEvent) and tree collision blocking.
 */
import { chromium } from 'playwright'

const url = process.env.GAME_URL || 'http://127.0.0.1:43217/'

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.click('#start-btn')
await page.waitForTimeout(400)
await page.locator('#game-canvas').click({ force: true })
await page.waitForTimeout(200)

const sens = await page.evaluate(() => window.__monkeyGame.getLookSensitivity())
if (sens < 0.0017) {
  console.error('FAIL lookSens too low', sens)
  process.exit(1)
}

// --- O overdrive via real key events ---
const beforeO = await page.evaluate(() => window.__monkeyGame.getOverdriveRemaining())
await page.keyboard.down('KeyO')
await page.keyboard.up('KeyO')
await page.waitForTimeout(50)
const afterO = await page.evaluate(() => window.__monkeyGame.getOverdriveRemaining())

// Also dispatch a synthetic KeyboardEvent in-page (mirrors browser path)
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', key: 'o', bubbles: true }))
})
await page.waitForTimeout(30)
const afterDispatch = await page.evaluate(() => window.__monkeyGame.getOverdriveRemaining())

const overdriveOk = afterO > 4.5 && afterDispatch > 4.5

// Speed check: with overdrive, same wish travel further
await page.evaluate(() => {
  const g = window.__monkeyGame
  g.activateOverdrive()
})
const pos0 = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
await page.evaluate(() => {
  window.__monkeyGame.debugHoldKey('KeyW', true)
  window.__monkeyGame.debugTick(30, 1 / 60)
  window.__monkeyGame.debugHoldKey('KeyW', false)
})
const posBoost = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
const boostDist = Math.hypot(posBoost.x - pos0.x, posBoost.z - pos0.z)

// Reset overdrive by waiting... or just compare to non-boost later
// Without boost, 30 ticks at 8.5 ≈ 4.25; with 2.5× ≈ 10.6
const speedOk = boostDist > 8

// --- Tree collision ---
const colInfo = await page.evaluate(() => {
  const g = window.__monkeyGame
  const n = g.getColliderCount()
  // Teleport beside nearest trunk then try to walk through it
  const c = g.getNearestCollider()
  if (!c) return { n, ok: false, reason: 'no collider' }
  // Place player just outside, then force move into center
  const ang = Math.atan2(g.getPlayerPosition().z - c.z, g.getPlayerPosition().x - c.x)
  const standDist = c.r + 0.55
  g.playerPos.x = c.x + Math.cos(ang) * standDist
  g.playerPos.z = c.z + Math.sin(ang) * standDist
  g.playerPos.y = 2
  const before = { x: g.playerPos.x, z: g.playerPos.z }
  // Drive toward trunk center for half a second of sim
  const dx = c.x - before.x
  const dz = c.z - before.z
  const len = Math.hypot(dx, dz) || 1
  g.velocity.set((dx / len) * 12, 0, (dz / len) * 12)
  // Manual steps calling resolve via movement
  g.debugHoldKey('KeyW', false)
  for (let i = 0; i < 40; i++) {
    // Point look toward trunk
    g.lookYaw = Math.atan2(-(c.x - g.playerPos.x), -(c.z - g.playerPos.z))
    g.yaw = g.lookYaw
    g.debugHoldKey('KeyW', true)
    g.debugTick(1, 1 / 60)
  }
  g.debugHoldKey('KeyW', false)
  const after = { x: g.playerPos.x, z: g.playerPos.z }
  const distAfter = Math.hypot(after.x - c.x, after.z - c.z)
  const penetrated = distAfter < c.r + 0.35
  return {
    n,
    c,
    before,
    after,
    distAfter,
    minAllowed: c.r + 0.5,
    penetrated,
    ok: n > 50 && !penetrated && distAfter >= c.r + 0.45,
  }
})

const ok = overdriveOk && speedOk && colInfo.ok && beforeO === 0

console.log(
  JSON.stringify(
    {
      ok,
      sens,
      beforeO,
      afterO,
      afterDispatch,
      overdriveOk,
      boostDist: Number(boostDist.toFixed(2)),
      speedOk,
      collision: colInfo,
    },
    null,
    2,
  ),
)

await browser.close()
process.exit(ok ? 0 : 1)
