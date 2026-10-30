/**
 * Live gameplay checks: trunk overlap, arrow move, banana pickup on contact.
 * Fails if the capsule center ends inside a palm visual, or bananas don't collect.
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
await page.waitForTimeout(500)
await page.locator('#game-canvas').click({ force: true })
await page.waitForTimeout(200)

// --- Look sens still sane ---
const sens = await page.evaluate(() => window.__monkeyGame.getLookSensitivity())

// --- Trunk collision vs LIVE instance matrices ---
const trunk = await page.evaluate(() => window.__monkeyGame.debugProbeNearestTrunk())

// --- Arrow keys move the player ---
const beforeArrow = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
await page.evaluate(() => {
  const g = window.__monkeyGame
  g.yaw = 0
  g.lookYaw = 0
  g.debugHoldKey('ArrowUp', true)
  g.debugTick(40, 1 / 60)
  g.debugHoldKey('ArrowUp', false)
})
const afterUp = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
const forwardDist = Math.hypot(afterUp.x - beforeArrow.x, afterUp.z - beforeArrow.z)

await page.evaluate(() => {
  const g = window.__monkeyGame
  g.debugHoldKey('ArrowLeft', true)
  g.debugTick(25, 1 / 60)
  g.debugHoldKey('ArrowLeft', false)
})
const afterLeft = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
const strafeDist = Math.hypot(afterLeft.x - afterUp.x, afterLeft.z - afterUp.z)

// Real KeyboardEvent path for ArrowDown
const beforeDown = afterLeft
await page.keyboard.down('ArrowDown')
await page.waitForTimeout(350)
await page.keyboard.up('ArrowDown')
await page.waitForTimeout(50)
const afterDown = await page.evaluate(() => {
  const p = window.__monkeyGame.getPlayerPosition()
  return { x: p.x, z: p.z }
})
const arrowKeyEventMoved =
  Math.hypot(afterDown.x - beforeDown.x, afterDown.z - beforeDown.z) > 0.15

// --- Banana collection on contact (teleport onto an uncollected banana) ---
const bananaResult = await page.evaluate(() => {
  const g = window.__monkeyGame
  const bananas = g.getBananaPositions()
  const startCount = g.getBananaCount()

  for (let i = 0; i < bananas.length; i++) {
    const before = g.getBananaCount()
    const b = bananas[i]
    g.playerPos.x = b.x
    g.playerPos.z = b.z
    g.playerPos.y = b.y
    g.velocity.set(0, 0, 0)
    g.debugTick(6, 1 / 60)
    const after = g.getBananaCount()
    if (after === before + 1) {
      const hud = document.getElementById('banana-count')?.textContent
      const mesh = g.world.bananaInstances
      let buried = null
      if (mesh) {
        const m = new mesh.matrix.constructor()
        const p = new mesh.position.constructor()
        const q = new mesh.quaternion.constructor()
        const s = new mesh.position.constructor()
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        buried = { y: p.y, sx: s.x }
      }
      return {
        ok: hud === String(after) && buried !== null && buried.y < -5,
        before,
        after,
        startCount,
        hud,
        target: { i, x: b.x, z: b.z },
        buried,
      }
    }
  }
  return { ok: false, reason: 'no banana collected on contact', startCount, after: g.getBananaCount() }
})

// Second banana via walking into it with ArrowUp
const bananaWalk = await page.evaluate(() => {
  const g = window.__monkeyGame
  const bananas = g.getBananaPositions()
  for (let i = 0; i < bananas.length; i++) {
    const before = g.getBananaCount()
    const b = bananas[i]
    g.playerPos.x = b.x + 2.4
    g.playerPos.z = b.z
    g.playerPos.y = b.y
    g.yaw = Math.atan2(-(b.x - g.playerPos.x), -(b.z - g.playerPos.z))
    g.lookYaw = g.yaw
    g.debugHoldKey('ArrowUp', true)
    g.debugTick(60, 1 / 60)
    g.debugHoldKey('ArrowUp', false)
    const after = g.getBananaCount()
    if (after > before) {
      return { ok: true, before, after, target: { i, x: b.x, z: b.z } }
    }
  }
  return { ok: false, before: g.getBananaCount(), after: g.getBananaCount() }
})

// Obstacles exist and some bananas remain freely approachable
const obstacles = await page.evaluate(() => {
  const g = window.__monkeyGame
  const n = g.getColliderCount()
  // Colliders should exceed trees/bushes/rocks alone (obstacles added)
  return { colliderCount: n, ok: n > 320 }
})

const ok =
  sens >= 0.0017 &&
  trunk.ok &&
  forwardDist > 2 &&
  strafeDist > 1 &&
  arrowKeyEventMoved &&
  bananaResult.ok &&
  bananaWalk.ok &&
  obstacles.ok

console.log(
  JSON.stringify(
    {
      ok,
      sens,
      trunk,
      forwardDist: Number(forwardDist.toFixed(2)),
      strafeDist: Number(strafeDist.toFixed(2)),
      arrowKeyEventMoved,
      bananaResult,
      bananaWalk,
      obstacles,
    },
    null,
    2,
  ),
)

await browser.close()
process.exit(ok ? 0 : 1)
