import { chromium } from 'playwright'

const url = process.env.GAME_URL || 'http://127.0.0.1:43217/'
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-background-timer-throttling'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.click('#start-btn')
await page.waitForTimeout(500)

const result = await page.evaluate(() => {
  const g = window.__monkeyGame
  const THREE = window.THREE || null
  // Find trunk InstancedMesh via scene graph on game
  const scene = g.scene || g.renderer?.domElement
  // Access private via bracket - world is on instance
  const world = g.world
  const colliders = world.colliders

  // Find cylinder InstancedMesh in world.group
  let trunks = null
  world.group.traverse((o) => {
    if (o.isInstancedMesh && o.geometry?.type === 'CylinderGeometry' && (!trunks || o.count > trunks.count)) {
      trunks = o
    }
  })

  const m = new (awaitImportMatrix())()
  // use three from trunks
  const Matrix4 = trunks.matrix.constructor
  const Vector3 = trunks.position.constructor
  const Quaternion = Object.getPrototypeOf(trunks.quaternion).constructor
  const mat = new Matrix4()
  const pos = new Vector3()
  const quat = new trunks.quaternion.constructor()
  const scl = new Vector3()

  function awaitImportMatrix() { return trunks.matrix.constructor }

  const mismatches = []
  const n = Math.min(trunks.count, 80)
  for (let i = 0; i < n; i++) {
    trunks.getMatrixAt(i, mat)
    mat.decompose(pos, quat, scl)
    let best = null
    for (const c of colliders) {
      const d = Math.hypot(pos.x - c.x, pos.z - c.z)
      if (!best || d < best.d) best = { d, c }
    }
    const visualR = 0.28 * Math.max(scl.x, scl.z)
    if (best.d > 0.15) {
      mismatches.push({ i, pos: { x: pos.x, z: pos.z }, bestD: best.d, visualR, colR: best.c.r })
    }
  }

  // Pick trunk nearest spawn / player
  const player = g.getPlayerPosition()
  let nearestTrunk = null
  for (let i = 0; i < trunks.count; i++) {
    trunks.getMatrixAt(i, mat)
    mat.decompose(pos, quat, scl)
    const d = Math.hypot(pos.x - player.x, pos.z - player.z)
    if (!nearestTrunk || d < nearestTrunk.d) {
      nearestTrunk = {
        i,
        d,
        x: pos.x,
        z: pos.z,
        y: pos.y,
        sx: scl.x,
        sy: scl.y,
        sz: scl.z,
        visualR: 0.28 * Math.max(scl.x, scl.z),
      }
    }
  }

  // Matching collider for that trunk
  let matchCol = null
  for (const c of colliders) {
    const d = Math.hypot(nearestTrunk.x - c.x, nearestTrunk.z - c.z)
    if (!matchCol || d < matchCol.d) matchCol = { d, c }
  }

  // Place player at trunk center and tick (standing still) — should push out
  g.playerPos.x = nearestTrunk.x
  g.playerPos.z = nearestTrunk.z
  g.playerPos.y = nearestTrunk.y + 0.1
  g.velocity.set(0, 0, 0)
  g.debugTick(10, 1 / 60)
  const afterStand = g.getPlayerPosition()
  const standDist = Math.hypot(afterStand.x - nearestTrunk.x, afterStand.z - nearestTrunk.z)

  // Place just outside visual trunk, walk into center
  const ang = 0
  const startDist = nearestTrunk.visualR + 0.15
  g.playerPos.x = nearestTrunk.x + Math.cos(ang) * startDist
  g.playerPos.z = nearestTrunk.z + Math.sin(ang) * startDist
  g.playerPos.y = nearestTrunk.y + 0.1
  g.lookYaw = Math.PI // face -z? aim toward trunk
  g.yaw = Math.atan2(-(nearestTrunk.x - g.playerPos.x), -(nearestTrunk.z - g.playerPos.z))
  g.lookYaw = g.yaw
  g.debugHoldKey('KeyW', true)
  g.debugTick(45, 1 / 60)
  g.debugHoldKey('KeyW', false)
  const afterWalk = g.getPlayerPosition()
  const walkDist = Math.hypot(afterWalk.x - nearestTrunk.x, afterWalk.z - nearestTrunk.z)

  // Also: force move into trunk without wish (raw velocity)
  g.playerPos.x = nearestTrunk.x + nearestTrunk.visualR + 0.2
  g.playerPos.z = nearestTrunk.z
  for (let i = 0; i < 30; i++) {
    g.playerPos.x -= 0.08
    // call resolve via private? use debugTick with velocity
  }
  // Use public path: set pos inside visual and tick
  g.playerPos.x = nearestTrunk.x + 0.05
  g.playerPos.z = nearestTrunk.z + 0.05
  g.velocity.set(0, 0, 0)
  g.debugTick(5, 1 / 60)
  const afterInside = g.getPlayerPosition()
  const insideDist = Math.hypot(afterInside.x - nearestTrunk.x, afterInside.z - nearestTrunk.z)

  return {
    colliderCount: colliders.length,
    trunkCount: trunks.count,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 5),
    nearestTrunk,
    matchCol,
    standDist,
    walkDist,
    insideDist,
    playerRadius: 0.5,
    // Can player center be inside visual trunk after resolution?
    standInsideVisual: standDist < nearestTrunk.visualR,
    walkInsideVisual: walkDist < nearestTrunk.visualR,
    insideInsideVisual: insideDist < nearestTrunk.visualR,
    standInsideCollider: matchCol ? standDist < matchCol.c.r : null,
    walkInsideCollider: matchCol ? walkDist < matchCol.c.r : null,
  }
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
process.exit(result.walkInsideVisual || result.standInsideVisual || result.insideInsideVisual ? 1 : 0)
