import * as THREE from 'three'
import { biomeAt, groundHeight, GATE_Z, ISLAND_RADIUS, WATER_LEVEL } from './terrain'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface WorldParts {
  group: THREE.Group
  ocean: THREE.Mesh
  sun: THREE.Mesh
  gate: THREE.Group
  vendorStand: THREE.Group
  vendorAnchor: THREE.Vector3
  fauna: THREE.Group
  bananaPositions: THREE.Vector3[]
  trees: THREE.Object3D[]
}

export function createWorld(scene: THREE.Scene): WorldParts {
  const group = new THREE.Group()
  scene.add(group)

  // Sky atmosphere
  scene.background = new THREE.Color(0x74c7e3)
  scene.fog = new THREE.FogExp2(0x9ad4e8, 0.012)

  const hemi = new THREE.HemisphereLight(0xb1e4ff, 0x7a5a32, 0.85)
  scene.add(hemi)

  const sunLight = new THREE.DirectionalLight(0xfff1c9, 1.55)
  sunLight.position.set(40, 55, 18)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 1
  sunLight.shadow.camera.far = 140
  sunLight.shadow.camera.left = -55
  sunLight.shadow.camera.right = 55
  sunLight.shadow.camera.top = 55
  sunLight.shadow.camera.bottom = -55
  scene.add(sunLight)

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4.5, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe566 }),
  )
  sun.position.set(55, 42, 30)
  scene.add(sun)

  const ambient = new THREE.AmbientLight(0xffffff, 0.22)
  scene.add(ambient)

  // Island terrain mesh
  const seg = 128
  const size = ISLAND_RADIUS * 2.2
  const geo = new THREE.PlaneGeometry(size, size, seg, seg)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors: number[] = []
  const sand = new THREE.Color(0xe8c98a)
  const grass = new THREE.Color(0x3f9a4a)
  const grassDeep = new THREE.Color(0x2d6e36)
  const rock = new THREE.Color(0x7a7368)
  const wetSand = new THREE.Color(0xd2b074)
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = groundHeight(x, z)
    pos.setY(i, y)
    const biome = biomeAt(x, z)
    if (y < WATER_LEVEL + 0.25) c.copy(wetSand)
    else if (biome === 'sand') c.copy(sand)
    else if (biome === 'rock') c.copy(rock)
    else c.copy(grass).lerp(grassDeep, Math.min(1, (y - 1) / 4))
    colors.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const island = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
    }),
  )
  island.receiveShadow = true
  island.castShadow = true
  group.add(island)

  // Ocean
  const oceanGeo = new THREE.PlaneGeometry(900, 900, 64, 64)
  oceanGeo.rotateX(-Math.PI / 2)
  const ocean = new THREE.Mesh(
    oceanGeo,
    new THREE.MeshStandardMaterial({
      color: 0x1a8fb0,
      roughness: 0.28,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
    }),
  )
  ocean.position.y = WATER_LEVEL
  ocean.receiveShadow = true
  group.add(ocean)

  // Distant horizon ring (no other land)
  const horizon = new THREE.Mesh(
    new THREE.RingGeometry(220, 420, 64),
    new THREE.MeshBasicMaterial({
      color: 0x5eb4d2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    }),
  )
  horizon.rotation.x = -Math.PI / 2
  horizon.position.y = WATER_LEVEL + 0.02
  group.add(horizon)

  const rand = mulberry32(42)
  const trees: THREE.Object3D[] = []

  // Coconut palms & bushes & rocks
  for (let i = 0; i < 48; i++) {
    const a = rand() * Math.PI * 2
    const r = 8 + rand() * (ISLAND_RADIUS * 0.7)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.35) continue
    if (z > GATE_Z - 1 && Math.abs(x) < 8) continue
    const tree = makePalm(rand)
    tree.position.set(x, y, z)
    tree.rotation.y = rand() * Math.PI * 2
    group.add(tree)
    trees.push(tree)
  }

  for (let i = 0; i < 55; i++) {
    const x = (rand() - 0.5) * ISLAND_RADIUS * 1.5
    const z = (rand() - 0.5) * ISLAND_RADIUS * 1.5
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.3) continue
    const bush = makeBush(rand)
    bush.position.set(x, y, z)
    group.add(bush)
  }

  for (let i = 0; i < 28; i++) {
    const x = (rand() - 0.5) * ISLAND_RADIUS * 1.6
    const z = (rand() - 0.5) * ISLAND_RADIUS * 1.6
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.2) continue
    const rockMesh = makeRock(rand)
    rockMesh.position.set(x, y, z)
    group.add(rockMesh)
  }

  // Gate / North Cove barrier
  const gate = new THREE.Group()
  gate.position.set(0, 0, GATE_Z)
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 })
  for (const sx of [-4.2, 4.2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.2, 0.45), postMat)
    post.position.set(sx, 1.6, 0)
    post.castShadow = true
    gate.add(post)
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.35, 0.25), postMat)
  bar.position.set(0, 2.4, 0)
  gate.add(bar)
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.1, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xd7b26a }),
  )
  sign.position.set(0, 1.5, 0.2)
  gate.add(sign)
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 8.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xc4a35a }),
  )
  rope.rotation.z = Math.PI / 2
  rope.position.set(0, 1.1, 0)
  rope.name = 'gateRope'
  gate.add(rope)
  // Place gate on terrain
  gate.position.y = groundHeight(0, GATE_Z)
  group.add(gate)

  // Vendor stand
  const vendorStand = createVendorStand()
  const vx = -10
  const vz = -6
  vendorStand.position.set(vx, groundHeight(vx, vz), vz)
  vendorStand.rotation.y = 0.6
  group.add(vendorStand)

  // Bananas — starter cluster near spawn, trail toward vendor, cove stash
  const bananaPositions: THREE.Vector3[] = []
  const pushBanana = (x: number, z: number) => {
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.25) return
    bananaPositions.push(new THREE.Vector3(x, y + 0.35, z))
  }
  const starters: [number, number][] = [
    [2, -10],
    [-2, -9],
    [3, -8],
    [-1, -7],
    [4, -11],
    [-4, -10],
    [-7, -7],
    [-9, -5],
    [-8, -4],
  ]
  for (const [x, z] of starters) pushBanana(x, z)
  for (let i = 0; i < 8; i++) {
    pushBanana((rand() - 0.5) * 10, GATE_Z + 4 + rand() * 10)
  }
  for (let i = 0; i < 24; i++) {
    const a = rand() * Math.PI * 2
    const r = 6 + rand() * (ISLAND_RADIUS * 0.75)
    pushBanana(Math.cos(a) * r, Math.sin(a) * r)
  }

  const fauna = new THREE.Group()
  group.add(fauna)
  spawnFauna(fauna, rand)

  return {
    group,
    ocean,
    sun,
    gate,
    vendorStand,
    vendorAnchor: new THREE.Vector3(vx, groundHeight(vx, vz), vz),
    fauna,
    bananaPositions,
    trees,
  }
}

function makePalm(rand: () => number) {
  const g = new THREE.Group()
  const trunkH = 4.4 + rand() * 1.2
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.24, trunkH, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3d, roughness: 0.9 }),
  )
  trunk.position.y = trunkH / 2
  trunk.rotation.z = (rand() - 0.5) * 0.18
  trunk.castShadow = true
  g.add(trunk)

  const topY = trunkH - 0.15
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x2f9a44,
    side: THREE.DoubleSide,
    roughness: 0.75,
  })
  for (let i = 0; i < 7; i++) {
    const frond = new THREE.Group()
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.4, 6, 1, true), leafMat)
    leaf.rotation.x = Math.PI / 2
    leaf.position.z = 1.05
    leaf.castShadow = true
    frond.add(leaf)
    frond.position.y = topY
    frond.rotation.order = 'YXZ'
    frond.rotation.y = (i / 7) * Math.PI * 2 + rand() * 0.2
    frond.rotation.x = 0.55 + rand() * 0.25
    g.add(frond)
  }
  for (let i = 0; i < 3; i++) {
    const coco = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x5a3a1e }),
    )
    const ang = (i / 3) * Math.PI * 2
    coco.position.set(Math.cos(ang) * 0.22, topY - 0.4, Math.sin(ang) * 0.22)
    g.add(coco)
  }
  return g
}

function makeBush(rand: () => number) {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.28 + rand() * 0.06, 0.55, 0.32 + rand() * 0.1),
    roughness: 0.9,
  })
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.35 + rand() * 0.25, 10, 8), mat)
    s.position.set((rand() - 0.5) * 0.5, 0.3 + rand() * 0.2, (rand() - 0.5) * 0.5)
    s.castShadow = true
    g.add(s)
  }
  return g
}

function makeRock(rand: () => number) {
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.35 + rand() * 0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0x7d766c, roughness: 0.95, flatShading: true }),
  )
  mesh.scale.set(1 + rand(), 0.6 + rand() * 0.7, 1 + rand() * 0.4)
  mesh.rotation.set(rand(), rand(), rand())
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function createVendorStand() {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 })
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe4572e, roughness: 0.7 })

  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.2), wood)
  counter.position.y = 0.55
  counter.castShadow = true
  g.add(counter)

  const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), wood)
  poleL.position.set(-1.1, 1.5, -0.4)
  g.add(poleL)
  const poleR = poleL.clone()
  poleR.position.x = 1.1
  g.add(poleR)

  const awning = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 1.5), cloth)
  awning.position.set(0, 2.45, -0.1)
  awning.rotation.x = -0.15
  g.add(awning)

  // Merchandise display
  const items: { color: number; pos: [number, number, number]; geo: THREE.BufferGeometry }[] = [
    { color: 0xe63946, pos: [-0.8, 1.15, 0.15], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 10) },
    { color: 0x457b9d, pos: [-0.5, 1.15, 0.2], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 10) },
    { color: 0x2a9d8f, pos: [-0.2, 1.15, 0.12], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 10) },
    { color: 0x6b3e1e, pos: [0.2, 1.12, 0.2], geo: new THREE.SphereGeometry(0.14, 10, 8) },
    { color: 0xd4a373, pos: [0.55, 1.12, 0.15], geo: new THREE.BoxGeometry(0.22, 0.12, 0.22) },
    { color: 0x48cae4, pos: [0.9, 1.15, 0.18], geo: new THREE.CylinderGeometry(0.07, 0.09, 0.26, 10) },
    { color: 0x0077b6, pos: [1.15, 1.18, 0.05], geo: new THREE.CylinderGeometry(0.1, 0.12, 0.32, 10) },
  ]
  for (const it of items) {
    const m = new THREE.Mesh(it.geo, new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.55 }))
    m.position.set(...it.pos)
    m.castShadow = true
    g.add(m)
  }

  // Vendor monkey NPC (simpler)
  const npc = createSimpleVendorNpc()
  npc.position.set(0.1, 0.9, -0.55)
  g.add(npc)

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.5, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xa67c52 }),
  )
  crate.position.set(-1.4, 0.35, 0.5)
  g.add(crate)

  return g
}

function createSimpleVendorNpc() {
  const g = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color: 0x9a6b3f })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.35, 4, 8), fur)
  body.position.y = 0.45
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), fur)
  head.position.y = 0.95
  g.add(head)
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.24, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xf5c518 }),
  )
  hat.position.y = 1.12
  g.add(hat)
  return g
}

function spawnFauna(fauna: THREE.Group, rand: () => number) {
  // Birds
  for (let i = 0; i < 8; i++) {
    const bird = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0xf1faee }),
    )
    body.rotation.z = Math.PI / 2
    bird.add(body)
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.04, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xe63946 }),
    )
    wing.name = 'wing'
    bird.add(wing)
    bird.position.set((rand() - 0.5) * 60, 6 + rand() * 8, (rand() - 0.5) * 60)
    bird.userData = {
      kind: 'bird',
      phase: rand() * Math.PI * 2,
      radius: 18 + rand() * 22,
      speed: 0.25 + rand() * 0.35,
      height: bird.position.y,
    }
    fauna.add(bird)
  }

  // Crabs
  for (let i = 0; i < 7; i++) {
    const crab = new THREE.Group()
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe76f51 }),
    )
    shell.scale.set(1.2, 0.55, 1)
    crab.add(shell)
    for (const s of [-1, 1]) {
      const claw = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.05, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xf4a261 }),
      )
      claw.position.set(s * 0.18, 0, 0.12)
      crab.add(claw)
    }
    const a = rand() * Math.PI * 2
    const r = ISLAND_RADIUS * 0.55 + rand() * 8
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    crab.position.set(x, groundHeight(x, z) + 0.08, z)
    crab.userData = {
      kind: 'crab',
      phase: rand() * Math.PI * 2,
      ox: x,
      oz: z,
    }
    fauna.add(crab)
  }

  // Butterflies
  for (let i = 0; i < 10; i++) {
    const bf = new THREE.Group()
    const col = new THREE.Color().setHSL(rand(), 0.75, 0.55)
    const wingL = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 10),
      new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide }),
    )
    wingL.position.x = -0.08
    wingL.name = 'wingL'
    const wingR = wingL.clone()
    wingR.position.x = 0.08
    wingR.name = 'wingR'
    bf.add(wingL, wingR)
    const x = (rand() - 0.5) * 30
    const z = (rand() - 0.5) * 30
    bf.position.set(x, groundHeight(x, z) + 1.2 + rand(), z)
    bf.userData = {
      kind: 'butterfly',
      phase: rand() * Math.PI * 2,
      ox: x,
      oz: z,
    }
    fauna.add(bf)
  }
}

export function animateFauna(fauna: THREE.Group, t: number) {
  for (const child of fauna.children) {
    const d = child.userData
    if (d.kind === 'bird') {
      const ang = t * d.speed + d.phase
      child.position.x = Math.cos(ang) * d.radius
      child.position.z = Math.sin(ang) * d.radius
      child.position.y = d.height + Math.sin(t * 2 + d.phase) * 0.8
      child.rotation.y = -ang + Math.PI / 2
      const wing = child.getObjectByName('wing')
      if (wing) wing.rotation.z = Math.sin(t * 12 + d.phase) * 0.5
    } else if (d.kind === 'crab') {
      const wob = Math.sin(t * 1.5 + d.phase)
      child.position.x = d.ox + Math.cos(t * 0.4 + d.phase) * 1.2
      child.position.z = d.oz + Math.sin(t * 0.4 + d.phase) * 1.2
      child.position.y = groundHeight(child.position.x, child.position.z) + 0.08
      child.rotation.y = wob
    } else if (d.kind === 'butterfly') {
      child.position.x = d.ox + Math.sin(t * 0.9 + d.phase) * 1.5
      child.position.z = d.oz + Math.cos(t * 0.7 + d.phase) * 1.5
      child.position.y =
        groundHeight(child.position.x, child.position.z) + 1.1 + Math.sin(t * 3 + d.phase) * 0.4
      const wl = child.getObjectByName('wingL')
      const wr = child.getObjectByName('wingR')
      const flap = Math.sin(t * 16 + d.phase) * 0.7
      if (wl) wl.rotation.y = flap
      if (wr) wr.rotation.y = -flap
    }
  }
}

export function createBananaMesh() {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd12a, roughness: 0.45, emissive: 0x3a2a00, emissiveIntensity: 0.15 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 5, 10), mat)
  body.rotation.z = 0.85
  body.rotation.x = 0.25
  body.castShadow = true
  g.add(body)
  const body2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), mat)
  body2.position.set(0.08, 0.06, 0)
  body2.rotation.z = 1.15
  g.add(body2)
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3d2b1f }),
  )
  tip.position.set(-0.12, 0.18, 0.02)
  g.add(tip)
  g.scale.setScalar(1.15)
  return g
}

export function createRaft() {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0x8d6b45, roughness: 0.9 })
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8), wood)
    log.rotation.z = Math.PI / 2
    log.position.set(0, 0.12, (i - 2) * 0.28)
    log.castShadow = true
    g.add(log)
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), wood)
  mast.position.y = 0.9
  g.add(mast)
  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xfff1c9, side: THREE.DoubleSide }),
  )
  sail.position.set(0.35, 1.1, 0)
  g.add(sail)
  return g
}
