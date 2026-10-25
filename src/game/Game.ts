import * as THREE from 'three'
import { Input } from './input'
import { createMonkey } from './monkey'
import { SHOP_ITEMS, type ShopItemId } from './catalog'
import {
  animateFauna,
  createBananaMesh,
  createRaft,
  createWorld,
  type WorldParts,
} from './world'
import { GATE_Z, WATER_LEVEL, groundHeight } from './terrain'

interface Buffs {
  speedUntil: number
  jumpUntil: number
  guardUntil: number
  waterBoostUntil: number
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  private clock = new THREE.Clock()
  private input = new Input()
  private world!: WorldParts
  private player = createMonkey()
  private playerPos = new THREE.Vector3(0, 2, -12)
  private velocity = new THREE.Vector3()
  private onGround = false
  private yaw = 0
  private pitch = 0.28
  private bananas = 0
  private bananaMeshes: THREE.Group[] = []
  private collected = new Set<number>()
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
  private spawnPoint = new THREE.Vector3(0, 2, -12)
  private readonly camOffset = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private animId = 0
  private canvas: HTMLCanvasElement
  private eWasUp = true

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
  }

  start() {
    this.world = createWorld(this.scene)
    this.scene.add(this.player)
    this.player.position.copy(this.playerPos)

    this.world.bananaPositions.forEach((p, i) => {
      const b = createBananaMesh()
      b.position.copy(p)
      b.userData.index = i
      this.scene.add(b)
      this.bananaMeshes.push(b)
    })

    this.input.attach()
    window.addEventListener('resize', this.onResize)
    this.canvas.addEventListener('click', this.requestLock)
    document.getElementById('shop-close')?.addEventListener('click', () => this.setShopOpen(false))
    document.getElementById('shop-grid')?.addEventListener('click', this.onShopClick)
    this.onResize()
    this.updateHUD()
    this.renderShop()
    this.animId = requestAnimationFrame(this.loop)
  }

  beginPlay() {
    this.started = true
    document.getElementById('start-screen')?.classList.add('hidden')
    this.requestLock()
    this.toast('Welcome to Monkey Island — find bananas!', true)
  }

  dispose() {
    cancelAnimationFrame(this.animId)
    this.input.detach()
    window.removeEventListener('resize', this.onResize)
    this.canvas.removeEventListener('click', this.requestLock)
    this.renderer.dispose()
  }

  private requestLock = () => {
    if (!this.started || this.shopOpen) return
    this.canvas.requestPointerLock()
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
    // Ocean shimmer
    const oceanPos = this.world.ocean.geometry.attributes.position
    for (let i = 0; i < oceanPos.count; i++) {
      const x = oceanPos.getX(i)
      const z = oceanPos.getZ(i)
      oceanPos.setY(i, Math.sin(x * 0.08 + t * 1.4) * 0.12 + Math.cos(z * 0.07 + t * 1.1) * 0.1)
    }
    oceanPos.needsUpdate = true
    this.world.ocean.geometry.computeVertexNormals()

    animateFauna(this.world.fauna, t)
    this.bananaMeshes.forEach((b, i) => {
      if (this.collected.has(i)) return
      b.rotation.y = t * 2
      b.position.y = this.world.bananaPositions[i].y + Math.sin(t * 3 + i) * 0.08
    })

    if (this.toastTimer > 0) {
      this.toastTimer -= dt
      if (this.toastTimer <= 0) document.getElementById('toast')?.classList.add('hidden')
    }

    if (!this.started) {
      this.camera.position.set(-18, 12, -28)
      this.camera.lookAt(0, 1, 0)
      return
    }

    this.handleShopToggle()
    if (this.shopOpen) {
      this.updateCamera(dt)
      return
    }

    this.handleLook()
    this.handleMovement(dt, t)
    this.collectBananas()
    this.updateVendorProximity()
    this.updateCamera(dt)
    this.updateStatusPills(t)
  }

  private handleLook() {
    const { dx, dy } = this.input.consumeMouse()
    this.yaw -= dx * 0.0022
    this.pitch -= dy * 0.0022
    this.pitch = Math.max(-0.15, Math.min(0.85, this.pitch))
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
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const wish = new THREE.Vector3()
    if (this.input.pressed('KeyW')) wish.add(forward)
    if (this.input.pressed('KeyS')) wish.sub(forward)
    if (this.input.pressed('KeyA')) wish.sub(right)
    if (this.input.pressed('KeyD')) wish.add(right)
    if (wish.lengthSq() > 0) wish.normalize()

    const landY = groundHeight(this.playerPos.x, this.playerPos.z)
    const inWater = landY < WATER_LEVEL - 0.05
    const canSwim = this.owned.has('swim')
    const hasRaft = this.owned.has('raft')

    let speed = 7.2
    if (t < this.buffs.speedUntil) speed *= 1.55
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
          this.raft.rotation.y = this.yaw
          this.raft.visible = true
        }
      } else if (canSwim) {
        this.onRaft = false
        if (this.raft) this.raft.visible = false
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
    }

    // Gate collision
    if (!this.owned.has('unlock')) {
      const enteringCove =
        this.playerPos.z < GATE_Z && this.playerPos.z + wish.z * speed * dt > GATE_Z - 0.2
      if (
        enteringCove &&
        Math.abs(this.playerPos.x) < 4.5 &&
        Math.abs(this.playerPos.z - GATE_Z) < 2.5
      ) {
        wish.z = Math.min(wish.z, 0)
        if (wish.z === 0 && this.playerPos.z > GATE_Z - 1.2) {
          this.playerPos.z = Math.min(this.playerPos.z, GATE_Z - 0.6)
          this.toast('North Cove is locked — buy the key from Coco.')
        }
      }
      // Hard wall
      if (Math.abs(this.playerPos.x) < 4.6 && this.playerPos.z > GATE_Z - 0.5) {
        this.playerPos.z = Math.min(this.playerPos.z, GATE_Z - 0.55)
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

    this.playerPos.x += this.velocity.x * dt
    this.playerPos.z += this.velocity.z * dt
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

    // Soft world bound
    const r = Math.hypot(this.playerPos.x, this.playerPos.z)
    if (r > 120) {
      this.playerPos.x *= 120 / r
      this.playerPos.z *= 120 / r
    }

    this.player.position.copy(this.playerPos)
    if (wish.lengthSq() > 0.01) {
      const face = Math.atan2(wish.x, wish.z)
      this.player.rotation.y = face
      // walk bob
      this.player.position.y += Math.abs(Math.sin(t * 10)) * 0.04
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

  private collectBananas() {
    this.bananaMeshes.forEach((b, i) => {
      if (this.collected.has(i)) return
      // Gated bananas: only collectible if unlocked when behind gate
      const pos = this.world.bananaPositions[i]
      if (pos.z > GATE_Z && !this.owned.has('unlock')) return
      if (this.playerPos.distanceTo(b.position) < 1.1) {
        this.collected.add(i)
        b.visible = false
        this.bananas += 1
        this.updateHUD()
        this.toast(`Banana +1 · total ${this.bananas}`, true)
      }
    })
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

  private updateCamera(_dt: number) {
    const dist = 5.5
    const height = 2.2
    this.camOffset.set(
      Math.sin(this.yaw) * dist * Math.cos(this.pitch),
      height + Math.sin(this.pitch) * dist,
      Math.cos(this.yaw) * dist * Math.cos(this.pitch),
    )
    this.tmp.copy(this.playerPos).add(this.camOffset)
    this.camera.position.lerp(this.tmp, 0.18)
    this.camera.lookAt(this.playerPos.x, this.playerPos.y + 1.2, this.playerPos.z)
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
    this.world.gate.rotation.y = 0.9
    this.world.gate.position.x = 3.5
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
