import * as THREE from 'three'
import { Input } from './input'
import { createMonkey } from './monkey'
import { SHOP_ITEMS, type ShopItemId } from './catalog'
import {
  animateFauna,
  createRaft,
  createWorld,
  type WorldParts,
} from './world'
import {
  GATE_Z,
  SECOND_ISLAND,
  SECOND_ISLAND_RAFT_ONLY_RADIUS,
  WATER_LEVEL,
  distToSecondIsland,
  groundHeight,
  isOnSecondIsland,
} from './terrain'

interface Buffs {
  speedUntil: number
  jumpUntil: number
  guardUntil: number
  waterBoostUntil: number
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900)
  private clock = new THREE.Clock()
  private input = new Input()
  private world!: WorldParts
  private player = createMonkey()
  private playerPos = new THREE.Vector3(0, 2, -70)
  private velocity = new THREE.Vector3()
  private onGround = false
  /** Desired look (from mouse). */
  private yaw = 0
  private pitch = 0.16
  /** Smoothed look used by camera + movement. */
  private lookYaw = 0
  private lookPitch = 0.16
  private bananas = 0
  private collected = new Set<number>()
  private readonly bananaDummy = new THREE.Object3D()
  private owned = new Set<ShopItemId>()
  private shopOpen = false
  private started = false
  private nearVendor = false
  private raft: THREE.Group | null = null
  private onRaft = false
  private toastTimer = 0
  private drownGrace = 0
  private buffs: Buffs = {
    speedUntil: 0,
    jumpUntil: 0,
    guardUntil: 0,
    waterBoostUntil: 0,
  }
  private spawnPoint = new THREE.Vector3(0, 2, -70)
  private readonly camOffset = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private readonly camPos = new THREE.Vector3()
  private animId = 0
  private canvas: HTMLCanvasElement
  private eWasUp = true
  private softwareGl = false
  private frame = 0
  /** ~2× prior 0.00091 — still clamped + smoothed to avoid shake. */
  private readonly lookSens = 0.00185
  private readonly lookSmooth = 11
  private readonly maxMouseDelta = 36
  private overdriveUntil = 0
  /** Horizontal capsule radius — must stay outside solid prop colliders. */
  private readonly playerRadius = 0.55

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // big win; low-poly scene doesn't need MSAA
      powerPreference: 'high-performance',
    })
    // Cap DPR — 1.1 is plenty for this low-poly look and cuts fill cost hard
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.BasicShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08

    // Software WebGL (SwiftShader/llvmpipe) can't keep up with shadow maps / PBR
    const gl = this.renderer.getContext()
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const gpu = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      : ''
    if (/swiftshader|llvmpipe|softpipe|software/i.test(gpu)) {
      this.softwareGl = true
      this.renderer.shadowMap.enabled = false
      this.renderer.setPixelRatio(1)
      this.renderer.toneMapping = THREE.NoToneMapping
      console.info('[perf] Software WebGL detected — low-cost path:', gpu)
    } else {
      // Real GPU: tiny shadow budget (player only) — foliage never casts
      this.renderer.shadowMap.enabled = true
    }
  }

  start() {
    this.world = createWorld(this.scene, { softwareGl: this.softwareGl })
    if (this.softwareGl) {
      this.scene.fog = null
      const flatOcean = new THREE.MeshBasicMaterial({
        color: 0x1a8fb0,
        transparent: true,
        opacity: 0.9,
      })
      ;(this.world.ocean.material as THREE.Material).dispose()
      this.world.ocean.material = flatOcean
      this.world.ocean.geometry.dispose()
      this.world.ocean.geometry = new THREE.PlaneGeometry(1400, 1400, 1, 1)
      this.world.ocean.geometry.rotateX(-Math.PI / 2)
    }
    this.playerPos.y = groundHeight(this.playerPos.x, this.playerPos.z)
    this.spawnPoint.copy(this.playerPos)
    this.camPos.set(this.playerPos.x, this.playerPos.y + 4, this.playerPos.z + 8)
    this.scene.add(this.player)
    this.player.position.copy(this.playerPos)

    this.input.attach()
    this.input.onActionKey = (code) => {
      if (code === 'KeyO') this.activateOverdrive()
    }
    this.input.onPointerUnlock = () => {
      // Do not clear WASD. Prompt once; next pointerdown re-locks.
      if (this.started && !this.shopOpen) {
        this.toast('Click game to re-capture mouse', true)
      }
    }
    window.addEventListener('resize', this.onResize)
    // Re-lock on any press while playing — stop the cursor escaping the window
    this.canvas.addEventListener('pointerdown', this.requestLock)
    document.addEventListener('pointerdown', this.onDocPointerDown)
    document.getElementById('shop-close')?.addEventListener('click', () => this.setShopOpen(false))
    document.getElementById('shop-grid')?.addEventListener('click', this.onShopClick)
    this.onResize()
    this.updateHUD()
    this.renderShop()
    this.animId = requestAnimationFrame(this.loop)
  }

  beginPlay() {
    this.started = true
    const start = document.getElementById('start-screen')
    start?.classList.add('hidden')
    start?.setAttribute('aria-hidden', 'true')
    this.hardEjectIfEmbedded()
    this.requestLock()
    this.toast('Welcome to Monkey Island — find bananas!', true)
  }

  getPlayerPosition() {
    return this.playerPos.clone()
  }

  getLookAngles() {
    return { yaw: this.lookYaw, pitch: this.lookPitch }
  }

  isStarted() {
    return this.started
  }

  isStartScreenVisible() {
    const el = document.getElementById('start-screen')
    return !!el && !el.classList.contains('hidden')
  }

  /** Debug / QA helpers */
  debugTeleportToVendor() {
    this.playerPos.set(
      this.world.vendorAnchor.x + 1.5,
      this.world.vendorAnchor.y,
      this.world.vendorAnchor.z + 1.5,
    )
    this.playerPos.y = groundHeight(this.playerPos.x, this.playerPos.z)
    this.player.position.copy(this.playerPos)
    this.nearVendor = true
    this.updateVendorProximity()
  }

  debugOpenShop() {
    this.debugTeleportToVendor()
    this.setShopOpen(true)
  }

  debugAddBananas(n: number) {
    this.bananas += n
    this.updateHUD()
    this.renderShop()
  }

  /** Inject look delta as if the mouse moved while pointer-locked. */
  debugLook(dx: number, dy: number) {
    this.applyLookDelta(dx, dy)
    this.lookYaw = this.yaw
    this.lookPitch = this.pitch
  }

  debugHoldKey(code: string, down: boolean) {
    if (down) this.input.keys.add(code)
    else this.input.keys.delete(code)
  }

  /** Run N fixed simulation steps (for headless QA where rAF may throttle). */
  debugTick(steps = 60, dt = 1 / 60) {
    const t0 = this.clock.elapsedTime
    for (let i = 0; i < steps; i++) {
      this.update(dt, t0 + i * dt)
    }
  }

  dispose() {
    cancelAnimationFrame(this.animId)
    this.input.detach()
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('pointerdown', this.requestLock)
    document.removeEventListener('pointerdown', this.onDocPointerDown)
    this.renderer.dispose()
  }

  private onDocPointerDown = (e: PointerEvent) => {
    if (!this.started || this.shopOpen) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('#shop-overlay, #shop-panel, button, a')) return
    this.requestLock()
  }

  private requestLock = () => {
    if (!this.started || this.shopOpen) return
    if (document.pointerLockElement === this.canvas) return
    const canvas = this.canvas as HTMLCanvasElement & {
      requestPointerLock: (options?: { unadjustedMovement?: boolean }) => void
    }
    try {
      canvas.requestPointerLock({ unadjustedMovement: true })
    } catch {
      this.canvas.requestPointerLock()
    }
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private loop = () => {
    this.animId = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime
    this.update(dt, t)
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number, t: number) {
    this.frame++
    const oceanShader = (this.world.ocean.material as THREE.Material).userData?.shader as
      | { uniforms: { uTime: { value: number } } }
      | undefined
    if (oceanShader) oceanShader.uniforms.uTime.value = t

    // Fauna / banana bob: throttle CPU uploads (instancing stays)
    const faunaEvery = this.softwareGl ? 4 : 3
    if (this.frame % faunaEvery === 0) animateFauna(this.world.fauna, t)
    if (this.world.bananaInstances && this.frame % 3 === 0) {
      this.updateBananaInstances(t)
    }
    // Tight shadow frustum follows the player — big win vs island-wide map
    if (!this.softwareGl && this.frame % 4 === 0) {
      const light = this.world.sunLight
      light.position.set(this.playerPos.x + 55, 95, this.playerPos.z + 28)
      light.target.position.set(this.playerPos.x, this.playerPos.y, this.playerPos.z)
      light.target.updateMatrixWorld()
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) document.getElementById('toast')?.classList.add('hidden')
    }

    if (!this.started) {
      // Wide establishing shot — sky dome + beach/jungle contrast readable behind the start card
      this.camera.position.set(-36, 28, -108)
      this.camera.lookAt(12, 6, -20)
      return
    }

    this.handleShopToggle()
    if (this.shopOpen) {
      this.updateCamera(dt)
      return
    }

    this.handleLook(dt)
    this.handleMovement(dt, t)
    this.collectBananas()
    this.updateVendorProximity()
    this.updateCamera(dt)
    this.updateStatusPills(t)
  }

  /** Activate O overdrive from a real keydown (not polled edge-detect). */
  activateOverdrive() {
    // Shop / pointer-lock must not swallow O — only require play has started.
    if (!this.started) return
    const t = this.clock.elapsedTime
    // Refresh / stack to full 5s from now
    this.overdriveUntil = t + 5
    this.toast('Overdrive! Speed ×2.5 for 5s', true)
  }

  getOverdriveRemaining() {
    return Math.max(0, this.overdriveUntil - this.clock.elapsedTime)
  }

  getLookSensitivity() {
    return this.lookSens
  }

  /** Nearest solid collider (for QA). */
  getNearestCollider() {
    let best: { x: number; z: number; r: number; dist: number } | null = null
    for (const c of this.world.colliders) {
      const dist = Math.hypot(this.playerPos.x - c.x, this.playerPos.z - c.z)
      if (!best || dist < best.dist) best = { x: c.x, z: c.z, r: c.r, dist }
    }
    return best
  }

  getColliderCount() {
    return this.world.colliders.length
  }

  getBananaCount() {
    return this.bananas
  }

  getCollectedBananaCount() {
    return this.collected.size
  }

  getBananaPositions() {
    return this.world.bananaPositions.map((p) => p.clone())
  }

  /** True when capsule center is inside any solid (for QA). */
  isEmbeddedInSolid() {
    const pr = this.playerRadius
    for (const c of this.world.colliders) {
      if (Math.hypot(this.playerPos.x - c.x, this.playerPos.z - c.z) < c.r + pr - 0.02) {
        return true
      }
    }
    return false
  }

  /**
   * Walk the capsule into the nearest palm trunk instance and report whether the
   * center stayed outside the visual trunk radius (live-mesh test, not collider-only).
   */
  debugProbeNearestTrunk() {
    const trunkMeshes: THREE.InstancedMesh[] = []
    this.world.group.traverse((o) => {
      const m = o as THREE.InstancedMesh
      if (m.isInstancedMesh && m.geometry?.type === 'CylinderGeometry') {
        trunkMeshes.push(m)
      }
    })
    trunkMeshes.sort((a, b) => b.count - a.count)
    const trunks = trunkMeshes[0]
    if (!trunks || trunks.count === 0) return { ok: false, reason: 'no trunks' as const }

    const mat = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    let nearest: { x: number; z: number; visualR: number; d: number } | null = null
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, mat)
      mat.decompose(pos, quat, scl)
      const d = Math.hypot(pos.x - this.playerPos.x, pos.z - this.playerPos.z)
      const visualR = 0.28 * Math.max(scl.x, scl.z)
      if (!nearest || d < nearest.d) nearest = { x: pos.x, z: pos.z, visualR, d }
    }
    if (!nearest) return { ok: false, reason: 'no nearest' as const }

    // Stand just outside visual trunk, charge into center
    this.playerPos.x = nearest.x + nearest.visualR + 0.35
    this.playerPos.z = nearest.z
    this.playerPos.y = groundHeight(this.playerPos.x, this.playerPos.z)
    this.yaw = Math.atan2(-(nearest.x - this.playerPos.x), -(nearest.z - this.playerPos.z))
    this.lookYaw = this.yaw
    this.hardEjectIfEmbedded()
    this.debugHoldKey('KeyW', true)
    this.debugTick(50, 1 / 60)
    this.debugHoldKey('KeyW', false)
    const after = this.getPlayerPosition()
    const dist = Math.hypot(after.x - nearest.x, after.z - nearest.z)
    const margin = nearest.visualR + 0.2
    return {
      ok: dist >= margin && !this.isEmbeddedInSolid(),
      dist,
      visualR: nearest.visualR,
      margin,
      trunk: nearest,
      embedded: this.isEmbeddedInSolid(),
    }
  }

  private applyLookDelta(dx: number, dy: number) {
    const cdx = Math.max(-this.maxMouseDelta, Math.min(this.maxMouseDelta, dx))
    const cdy = Math.max(-this.maxMouseDelta, Math.min(this.maxMouseDelta, dy))
    this.yaw -= cdx * this.lookSens
    this.pitch -= cdy * this.lookSens
    this.pitch = Math.max(-0.12, Math.min(0.72, this.pitch))
  }

  private handleLook(dt: number) {
    const { dx, dy } = this.input.consumeMouse()
    this.applyLookDelta(dx, dy)
    const a = 1 - Math.exp(-this.lookSmooth * dt)
    this.lookYaw += (this.yaw - this.lookYaw) * a
    this.lookPitch += (this.pitch - this.lookPitch) * a
  }

  private handleShopToggle() {
    if (!this.input.pressed('KeyE')) {
      this.eWasUp = true
      return
    }
    if (!this.eWasUp) return
    this.eWasUp = false
    if (this.shopOpen) {
      this.setShopOpen(false)
      return
    }
    if (this.nearVendor) this.setShopOpen(true)
  }

  private setShopOpen(open: boolean) {
    this.shopOpen = open
    const overlay = document.getElementById('shop-overlay')
    if (!overlay) return
    overlay.classList.toggle('hidden', !open)
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true')
    if (open) {
      document.exitPointerLock()
      this.renderShop()
      this.setShopMessage('')
    } else if (this.started) {
      this.canvas.requestPointerLock()
    }
  }

  private handleMovement(dt: number, t: number) {
    const forward = new THREE.Vector3(-Math.sin(this.lookYaw), 0, -Math.cos(this.lookYaw))
    const right = new THREE.Vector3(Math.cos(this.lookYaw), 0, -Math.sin(this.lookYaw))
    const wish = new THREE.Vector3()
    // Arrows primary; WASD still works
    if (this.input.pressed('ArrowUp') || this.input.pressed('KeyW')) wish.add(forward)
    if (this.input.pressed('ArrowDown') || this.input.pressed('KeyS')) wish.sub(forward)
    if (this.input.pressed('ArrowLeft') || this.input.pressed('KeyA')) wish.sub(right)
    if (this.input.pressed('ArrowRight') || this.input.pressed('KeyD')) wish.add(right)
    if (wish.lengthSq() > 0) wish.normalize()

    const landY = groundHeight(this.playerPos.x, this.playerPos.z)
    const inWater = landY < WATER_LEVEL - 0.05
    const canSwim = this.owned.has('swim')
    const hasRaft = this.owned.has('raft')

    let speed = 8.5
    if (t < this.buffs.speedUntil) speed *= 1.55
    if (t < this.overdriveUntil) speed *= 2.5
    if (inWater && t < this.buffs.waterBoostUntil) speed *= 1.35

    if (inWater) {
      if (hasRaft) {
        this.ensureRaft()
        this.onRaft = true
        speed *= 1.25
        this.velocity.y = 0
        this.playerPos.y = WATER_LEVEL + 0.35
        if (this.raft) {
          this.raft.position.set(this.playerPos.x, WATER_LEVEL + 0.05, this.playerPos.z)
          this.raft.rotation.y = this.lookYaw
          this.raft.visible = true
        }
      } else if (canSwim) {
        this.onRaft = false
        if (this.raft) this.raft.visible = false
        // Swim is fine in the lagoon, but not across to the sister island
        if (distToSecondIsland(this.playerPos.x, this.playerPos.z) < SECOND_ISLAND_RAFT_ONLY_RADIUS) {
          this.blockSisterIslandWithoutRaft()
          return
        }
        speed *= 0.55
        this.playerPos.y = WATER_LEVEL - 0.05
        this.velocity.y = 0
        this.onGround = false
      } else {
        this.onRaft = false
        if (this.raft) this.raft.visible = false
        this.drownGrace += dt
        if (this.drownGrace > 0.55) this.failWater(t)
        return
      }
    } else {
      this.drownGrace = 0
      this.onRaft = false
      if (this.raft) this.raft.visible = false
      if (!hasRaft && isOnSecondIsland(this.playerPos.x, this.playerPos.z)) {
        this.blockSisterIslandWithoutRaft()
        return
      }
    }

    // Gate collision (wider opening on the larger island)
    const gateHalf = 7.8
    if (!this.owned.has('unlock')) {
      const enteringCove =
        this.playerPos.z < GATE_Z && this.playerPos.z + wish.z * speed * dt > GATE_Z - 0.2
      if (
        enteringCove &&
        Math.abs(this.playerPos.x) < gateHalf &&
        Math.abs(this.playerPos.z - GATE_Z) < 3
      ) {
        wish.z = Math.min(wish.z, 0)
        if (wish.z === 0 && this.playerPos.z > GATE_Z - 1.5) {
          this.playerPos.z = Math.min(this.playerPos.z, GATE_Z - 0.7)
          this.toast('North Cove is locked — buy the key from Coco.')
        }
      }
      if (Math.abs(this.playerPos.x) < gateHalf + 0.3 && this.playerPos.z > GATE_Z - 0.6) {
        this.playerPos.z = Math.min(this.playerPos.z, GATE_Z - 0.65)
      }
    }

    this.velocity.x = wish.x * speed
    this.velocity.z = wish.z * speed

    if (!inWater || (!canSwim && !hasRaft)) {
      // gravity / jump on land
      if (!inWater) {
        let jumpV = 8.2
        if (t < this.buffs.jumpUntil) jumpV = 11.5
        if (this.input.pressed('Space') && this.onGround) {
          this.velocity.y = jumpV
          this.onGround = false
        }
        this.velocity.y -= 22 * dt
      }
    } else if (canSwim && !hasRaft) {
      if (this.input.pressed('Space')) this.velocity.y = 2.5
      else this.velocity.y = 0
    }

    const prevX = this.playerPos.x
    const prevZ = this.playerPos.z

    // Axis-separated move so the capsule slides along trunks instead of embedding
    this.playerPos.x += this.velocity.x * dt
    this.resolveColliders(prevX, prevZ)
    const midX = this.playerPos.x
    const midZ = this.playerPos.z
    this.playerPos.z += this.velocity.z * dt
    this.resolveColliders(midX, midZ)

    // Sister island: raft required (swim alone cannot finish the crossing)
    if (!hasRaft) {
      const d2 = distToSecondIsland(this.playerPos.x, this.playerPos.z)
      if (d2 < SECOND_ISLAND_RAFT_ONLY_RADIUS || isOnSecondIsland(this.playerPos.x, this.playerPos.z)) {
        this.playerPos.x = prevX
        this.playerPos.z = prevZ
        if (this.frame % 45 === 0) {
          this.toast('Need a raft to reach the sister island — buy one from Coco.')
        }
      }
    }

    if (!inWater || (!canSwim && !hasRaft)) {
      this.playerPos.y += this.velocity.y * dt
    } else if (canSwim && this.input.pressed('Space') && !hasRaft) {
      this.playerPos.y = WATER_LEVEL + 0.25
    }

    const newLand = groundHeight(this.playerPos.x, this.playerPos.z)
    if (!inWater || newLand >= WATER_LEVEL - 0.05) {
      if (this.playerPos.y <= newLand + 0.02) {
        this.playerPos.y = newLand
        this.velocity.y = 0
        this.onGround = true
      } else {
        this.onGround = false
      }
    }

    // Soft world bound covering both islands
    const bound = 420
    const r = Math.hypot(this.playerPos.x - 80, this.playerPos.z)
    if (r > bound) {
      const cx = 80
      const dx = this.playerPos.x - cx
      const dz = this.playerPos.z
      const s = bound / Math.hypot(dx, dz)
      this.playerPos.x = cx + dx * s
      this.playerPos.z = dz * s
      // Bounds can shove the capsule into props — resolve again
      this.resolveColliders(prevX, prevZ)
    }

    this.player.position.copy(this.playerPos)
    if (wish.lengthSq() > 0.01) {
      const face = Math.atan2(wish.x, wish.z)
      this.player.rotation.y = face
      // Visual bob only on the mesh — camera lookAt stays on stable playerPos
      this.player.position.y += Math.abs(Math.sin(t * 10)) * 0.035
    }
  }

  private failWater(t: number) {
    if (t < this.buffs.guardUntil) {
      this.buffs.guardUntil = 0
      this.toast('Jade Guard saved you! Swim or raft recommended.', true)
      this.playerPos.copy(this.spawnPoint)
      this.playerPos.y = groundHeight(this.spawnPoint.x, this.spawnPoint.z)
      this.velocity.set(0, 0, 0)
      this.drownGrace = 0
      this.updateHUD()
      return
    }
    this.toast('Too deep! Buy Swimming or a Raft from Coco.')
    this.playerPos.copy(this.spawnPoint)
    this.playerPos.y = groundHeight(this.spawnPoint.x, this.spawnPoint.z)
    this.velocity.set(0, 0, 0)
    this.drownGrace = 0
  }

  private ensureRaft() {
    if (this.raft) return
    this.raft = createRaft()
    this.scene.add(this.raft)
  }

  private blockSisterIslandWithoutRaft() {
    const dx = this.playerPos.x - SECOND_ISLAND.x
    const dz = this.playerPos.z - SECOND_ISLAND.z
    const len = Math.hypot(dx, dz) || 1
    const push = SECOND_ISLAND_RAFT_ONLY_RADIUS + 2
    this.playerPos.x = SECOND_ISLAND.x + (dx / len) * push
    this.playerPos.z = SECOND_ISLAND.z + (dz / len) * push
    this.velocity.set(0, 0, 0)
    this.toast('Need a raft to reach the sister island — buy one from Coco.')
  }

  private resolveColliders(prevX: number, prevZ: number) {
    const pr = this.playerRadius
    // Multi-pass depenetration; always eject to the circle surface (never stay embedded)
    for (let pass = 0; pass < 8; pass++) {
      let hit = false
      for (const c of this.world.colliders) {
        const dx = this.playerPos.x - c.x
        const dz = this.playerPos.z - c.z
        const d = Math.hypot(dx, dz)
        const min = c.r + pr
        if (d >= min) continue
        hit = true
        if (d > 1e-6) {
          const s = min / d
          this.playerPos.x = c.x + dx * s
          this.playerPos.z = c.z + dz * s
        } else {
          // Exact center: eject toward where we came from, else +X
          const ix = prevX - c.x
          const iz = prevZ - c.z
          const il = Math.hypot(ix, iz)
          if (il > 1e-6) {
            this.playerPos.x = c.x + (ix / il) * min
            this.playerPos.z = c.z + (iz / il) * min
          } else {
            this.playerPos.x = c.x + min
            this.playerPos.z = c.z
          }
        }
      }
      if (!hit) return
    }
    // Still jammed between overlapping solids — reject the move
    this.playerPos.x = prevX
    this.playerPos.z = prevZ
    // If prev was already embedded (spawn / teleport), hard-eject from nearest
    this.hardEjectIfEmbedded()
  }

  /** Force the capsule outside every collider (used after stuck multipass / teleports). */
  private hardEjectIfEmbedded() {
    const pr = this.playerRadius
    for (let pass = 0; pass < 12; pass++) {
      let worst: { c: { x: number; z: number; r: number }; depth: number; dx: number; dz: number; d: number } | null =
        null
      for (const c of this.world.colliders) {
        const dx = this.playerPos.x - c.x
        const dz = this.playerPos.z - c.z
        const d = Math.hypot(dx, dz)
        const min = c.r + pr
        const depth = min - d
        if (depth > 0 && (!worst || depth > worst.depth)) {
          worst = { c, depth, dx, dz, d }
        }
      }
      if (!worst) return
      if (worst.d > 1e-6) {
        const s = (worst.c.r + pr) / worst.d
        this.playerPos.x = worst.c.x + worst.dx * s
        this.playerPos.z = worst.c.z + worst.dz * s
      } else {
        this.playerPos.x = worst.c.x + worst.c.r + pr
        this.playerPos.z = worst.c.z
      }
    }
  }

  private collectBananas() {
    const mesh = this.world.bananaInstances
    const reach = 1.55
    this.world.bananaPositions.forEach((pos, i) => {
      if (this.collected.has(i)) return
      if (pos.z > GATE_Z && !this.owned.has('unlock')) return
      // Horizontal contact — Y bob / slopes must not block pickup
      const horiz = Math.hypot(this.playerPos.x - pos.x, this.playerPos.z - pos.z)
      if (horiz < reach && Math.abs(this.playerPos.y - pos.y) < 2.4) {
        this.collected.add(i)
        this.bananas += 1
        if (mesh) {
          // Park instance underground so it cannot reappear if a later write races
          this.bananaDummy.position.set(pos.x, -20, pos.z)
          this.bananaDummy.scale.setScalar(0)
          this.bananaDummy.updateMatrix()
          mesh.setMatrixAt(i, this.bananaDummy.matrix)
          mesh.instanceMatrix.needsUpdate = true
        }
        this.updateHUD()
        this.toast(`Banana +1 · total ${this.bananas}`, true)
      }
    })
  }

  private updateBananaInstances(t: number) {
    const mesh = this.world.bananaInstances
    if (!mesh) return
    let dirty = false
    this.world.bananaPositions.forEach((pos, i) => {
      if (this.collected.has(i)) return
      this.bananaDummy.position.set(pos.x, pos.y + Math.sin(t * 3 + i) * 0.08, pos.z)
      this.bananaDummy.rotation.set(0.25, t * 2 + i, 0.85)
      this.bananaDummy.scale.setScalar(1.15)
      this.bananaDummy.updateMatrix()
      mesh.setMatrixAt(i, this.bananaDummy.matrix)
      dirty = true
    })
    if (dirty) mesh.instanceMatrix.needsUpdate = true
  }

  private updateVendorProximity() {
    const d = this.playerPos.distanceTo(this.world.vendorAnchor)
    this.nearVendor = d < 4.2
    const hint = document.getElementById('near-hint')
    if (!hint) return
    if (this.nearVendor && !this.shopOpen) {
      hint.textContent = 'Press E — talk to Coco / open shop'
      hint.classList.remove('hidden')
    } else {
      hint.classList.add('hidden')
    }
  }

  private updateCamera(dt: number) {
    const dist = 6.6
    const height = 2.7
    this.camOffset.set(
      Math.sin(this.lookYaw) * dist * Math.cos(this.lookPitch),
      height + Math.sin(this.lookPitch) * dist,
      Math.cos(this.lookYaw) * dist * Math.cos(this.lookPitch),
    )
    this.tmp.copy(this.playerPos).add(this.camOffset)
    const camGround = groundHeight(this.tmp.x, this.tmp.z) + 1.7
    if (this.tmp.y < camGround) this.tmp.y = camGround
    // Follow rate tied to dt so it doesn't jitter against look smoothing
    const follow = 1 - Math.exp(-16 * dt)
    this.camPos.lerp(this.tmp, follow)
    this.camera.position.copy(this.camPos)
    this.camera.lookAt(this.playerPos.x, this.playerPos.y + 1.25, this.playerPos.z)
  }

  private updateHUD() {
    const el = document.getElementById('banana-count')
    if (el) el.textContent = String(this.bananas)
    const bal = document.querySelector('#shop-balance strong')
    if (bal) bal.textContent = String(this.bananas)
  }

  private updateStatusPills(t: number) {
    const host = document.getElementById('status-pills')
    if (!host) return
    const pills: string[] = []
    if (this.owned.has('swim')) pills.push('Swim')
    if (this.owned.has('raft')) pills.push('Raft')
    if (this.owned.has('unlock')) pills.push('North Cove')
    if (t < this.buffs.speedUntil) pills.push('Sprint')
    if (t < this.buffs.jumpUntil) pills.push('Leap')
    if (t < this.buffs.guardUntil) pills.push('Guard')
    if (t < this.buffs.waterBoostUntil) pills.push('Hydrated')
    if (t < this.overdriveUntil) {
      const left = Math.max(0, this.overdriveUntil - t)
      pills.push(`Overdrive ${left.toFixed(1)}s`)
    }
    if (this.onRaft) pills.push('Afloat')
    host.innerHTML = pills.map((p) => `<span>${p}</span>`).join('')
  }

  private toast(msg: string, ok = false) {
    const el = document.getElementById('toast')
    if (!el) return
    el.textContent = msg
    el.classList.toggle('ok', ok)
    el.classList.remove('hidden')
    this.toastTimer = 2.4
  }

  private setShopMessage(msg: string, ok = false) {
    const el = document.getElementById('shop-message')
    if (!el) return
    el.textContent = msg
    el.classList.toggle('ok', ok)
  }

  private renderShop() {
    const grid = document.getElementById('shop-grid')
    if (!grid) return
    this.updateHUD()
    grid.innerHTML = SHOP_ITEMS.map((item) => {
      const owned = item.once && this.owned.has(item.id)
      const canAfford = this.bananas >= item.price
      let label = 'Buy'
      let disabled = false
      if (owned) {
        label = 'Owned'
        disabled = true
      } else if (!canAfford) {
        label = 'Need more bananas'
        disabled = true
      }
      return `<article class="shop-item${owned ? ' owned' : ''}" data-id="${item.id}">
        <h3>${item.name}</h3>
        <p>${item.description}</p>
        <div class="price">${item.price} bananas</div>
        <button type="button" data-buy="${item.id}" ${disabled ? 'disabled' : ''}>${label}</button>
      </article>`
    }).join('')
  }

  private onShopClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button[data-buy]') as HTMLButtonElement | null
    if (!btn || btn.disabled) return
    const id = btn.dataset.buy as ShopItemId
    this.buy(id)
  }

  private buy(id: ShopItemId) {
    const item = SHOP_ITEMS.find((s) => s.id === id)
    if (!item) return
    if (item.once && this.owned.has(id)) {
      this.setShopMessage('Already owned.')
      return
    }
    if (this.bananas < item.price) {
      this.setShopMessage(`Not enough bananas — need ${item.price}, have ${this.bananas}.`)
      this.renderShop()
      return
    }
    this.bananas -= item.price
    if (item.kind === 'unlock') {
      this.owned.add(id)
      if (id === 'unlock') this.openGate()
      if (id === 'raft') {
        this.ensureRaft()
        this.toast('Raft ready — sail from any shore!', true)
      }
      if (id === 'swim') this.toast('You can swim now!', true)
    } else {
      this.applyConsumable(id)
    }
    this.updateHUD()
    this.renderShop()
    this.setShopMessage(`Purchased ${item.name}!`, true)
  }

  private openGate() {
    const rope = this.world.gate.getObjectByName('gateRope')
    if (rope) rope.visible = false
    this.world.gate.rotation.y = 0.85
    this.world.gate.position.x = 6
    this.toast('North Cove unlocked!', true)
  }

  private applyConsumable(id: ShopItemId) {
    const t = this.clock.elapsedTime
    switch (id) {
      case 'potionRed':
        this.buffs.speedUntil = t + 12
        this.toast('Ruby Sprint! Faster on land.', true)
        break
      case 'potionBlue':
        this.buffs.jumpUntil = t + 15
        this.toast('Azure Leap! Higher jumps.', true)
        break
      case 'potionGreen':
        this.buffs.guardUntil = t + 45
        this.toast('Jade Guard active — one free save.', true)
        break
      case 'coconut':
        this.buffs.speedUntil = Math.max(this.buffs.speedUntil, t + 8)
        this.toast('Coconut refresh!', true)
        break
      case 'pbj':
        this.buffs.speedUntil = t + 10
        this.buffs.jumpUntil = t + 10
        this.toast('PB&J power!', true)
        break
      case 'waterBottle':
        this.buffs.waterBoostUntil = t + 12
        this.toast('Hydrated for a short swim boost.', true)
        break
      case 'waterJug':
        this.buffs.waterBoostUntil = t + 20
        this.toast('Fully hydrated — strong water boost.', true)
        break
      default:
        break
    }
  }
}
