import * as THREE from 'three'
import {
  biomeAt,
  groundHeight,
  GATE_Z,
  ISLAND_RADIUS,
  JUNGLE_RADIUS,
  WATER_LEVEL,
  isClearing,
} from './terrain'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface WorldOptions {
  /** Fewer instances / cheaper mats for SwiftShader. */
  softwareGl?: boolean
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
  sunLight: THREE.DirectionalLight
}

const PALM_TRUNK_MAT = new THREE.MeshLambertMaterial({ color: 0x8a6a3d })
const PALM_CANOPY_MAT = new THREE.MeshLambertMaterial({ color: 0x2f9a44, side: THREE.DoubleSide })
const BUSH_MAT = new THREE.MeshLambertMaterial({ color: 0x2d7a38 })
const BUSH_MAT_B = new THREE.MeshLambertMaterial({ color: 0x3a9144 })
const ROCK_MAT = new THREE.MeshLambertMaterial({ color: 0x7d766c })

export function createWorld(scene: THREE.Scene, opts: WorldOptions = {}): WorldParts {
  const software = !!opts.softwareGl
  const group = new THREE.Group()
  scene.add(group)

  scene.background = new THREE.Color(0x74c7e3)
  // Lighter fog on the larger island so distant jungle still reads
  scene.fog = new THREE.FogExp2(0x9ad4e8, software ? 0.008 : 0.0055)

  const hemi = new THREE.HemisphereLight(0xb1e4ff, 0x7a5a32, 0.85)
  scene.add(hemi)

  const sunLight = new THREE.DirectionalLight(0xfff1c9, 1.55)
  sunLight.position.set(90, 110, 40)
  sunLight.castShadow = !software
  sunLight.shadow.mapSize.set(1024, 1024)
  sunLight.shadow.camera.near = 2
  sunLight.shadow.camera.far = 320
  const shadowExtent = ISLAND_RADIUS * 0.85
  sunLight.shadow.camera.left = -shadowExtent
  sunLight.shadow.camera.right = shadowExtent
  sunLight.shadow.camera.top = shadowExtent
  sunLight.shadow.camera.bottom = -shadowExtent
  sunLight.shadow.bias = -0.0008
  scene.add(sunLight)

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(8, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff0a0 }),
  )
  sun.position.set(120, 70, 55)
  scene.add(sun)
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(14, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  )
  sunGlow.position.copy(sun.position)
  scene.add(sunGlow)

  scene.add(new THREE.AmbientLight(0xffffff, 0.22))

  // Island terrain
  const seg = software ? 72 : 128
  const size = ISLAND_RADIUS * 2.15
  const geo = new THREE.PlaneGeometry(size, size, seg, seg)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors: number[] = []
  const sand = new THREE.Color(0xedcfa0)
  const wetSand = new THREE.Color(0xd4b078)
  const grass = new THREE.Color(0x4aa84f)
  const jungle = new THREE.Color(0x1f6b32)
  const jungleDeep = new THREE.Color(0x145226)
  const rock = new THREE.Color(0x7a7368)
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = groundHeight(x, z)
    pos.setY(i, y)
    const biome = biomeAt(x, z)
    if (y < WATER_LEVEL + 0.28) c.copy(wetSand)
    else if (biome === 'sand') c.copy(sand)
    else if (biome === 'rock') c.copy(rock)
    else if (biome === 'jungle') c.copy(jungle).lerp(jungleDeep, Math.min(1, (y - 0.8) / 5))
    else c.copy(grass).lerp(jungle, 0.35)
    colors.push(c.r, c.g, c.b)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const island = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  )
  island.receiveShadow = !software
  island.castShadow = false
  group.add(island)

  // Ocean
  const oceanSeg = software ? 1 : 40
  const oceanGeo = new THREE.PlaneGeometry(1400, 1400, oceanSeg, oceanSeg)
  oceanGeo.rotateX(-Math.PI / 2)
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x1a8fb0,
    roughness: 0.28,
    metalness: 0.35,
    transparent: true,
    opacity: 0.92,
  })
  if (!software) {
    oceanMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += sin(position.x * 0.06 + uTime * 1.4) * 0.14
                        + cos(position.z * 0.05 + uTime * 1.1) * 0.11;`,
      )
      oceanMat.userData.shader = shader
    }
    oceanMat.customProgramCacheKey = () => 'monkey-ocean-waves-v2'
  }
  const ocean = new THREE.Mesh(oceanGeo, oceanMat)
  ocean.position.y = WATER_LEVEL
  ocean.receiveShadow = false
  group.add(ocean)

  const horizon = new THREE.Mesh(
    new THREE.RingGeometry(400, 700, 48),
    new THREE.MeshBasicMaterial({
      color: 0x5eb4d2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.32,
    }),
  )
  horizon.rotation.x = -Math.PI / 2
  horizon.position.y = WATER_LEVEL + 0.02
  group.add(horizon)

  const rand = mulberry32(42)
  const trees: THREE.Object3D[] = []

  // --- Instanced jungle (few draw calls, high density) ---
  const palmCount = software ? 48 : 160
  const bushCount = software ? 60 : 220
  const rockCount = software ? 16 : 36
  placeInstancedPalms(group, rand, palmCount, software)
  placeInstancedBushes(group, rand, bushCount)
  placeInstancedRocks(group, rand, rockCount)

  // Gate / North Cove
  const gate = buildGate()
  gate.position.set(0, groundHeight(0, GATE_Z), GATE_Z)
  group.add(gate)

  // Vendor on the SW beach — easy to spot from south spawn
  const vendorStand = createVendorStand()
  const vx = -32
  const vz = -48
  vendorStand.position.set(vx, groundHeight(vx, vz), vz)
  vendorStand.rotation.y = 0.55
  group.add(vendorStand)

  // Bananas
  const bananaPositions: THREE.Vector3[] = []
  const pushBanana = (x: number, z: number) => {
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.25) return
    bananaPositions.push(new THREE.Vector3(x, y + 0.35, z))
  }
  // Starters near south spawn + trail to vendor
  const starters: [number, number][] = [
    [3, -68],
    [-3, -66],
    [5, -64],
    [-2, -62],
    [0, -60],
    [-12, -56],
    [-20, -52],
    [-28, -50],
    [-30, -46],
  ]
  for (const [x, z] of starters) pushBanana(x, z)
  // Cove stash
  for (let i = 0; i < 14; i++) {
    pushBanana((rand() - 0.5) * 22, GATE_Z + 8 + rand() * 22)
  }
  // Scattered inland / beach
  const scatterN = software ? 40 : 90
  for (let i = 0; i < scatterN; i++) {
    const a = rand() * Math.PI * 2
    const r = 12 + rand() * (ISLAND_RADIUS * 0.78)
    pushBanana(Math.cos(a) * r, Math.sin(a) * r)
  }

  const fauna = new THREE.Group()
  group.add(fauna)
  spawnFauna(fauna, rand, software)

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
    sunLight,
  }
}

function placeInstancedPalms(
  group: THREE.Group,
  rand: () => number,
  count: number,
  software: boolean,
) {
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.26, 1, software ? 5 : 7)
  trunkGeo.translate(0, 0.5, 0)
  const canopyGeo = buildCanopyGeometry(software)

  const trunks = new THREE.InstancedMesh(trunkGeo, PALM_TRUNK_MAT, count)
  const canopies = new THREE.InstancedMesh(canopyGeo, PALM_CANOPY_MAT, count)
  trunks.castShadow = !software
  trunks.receiveShadow = false
  canopies.castShadow = false
  canopies.receiveShadow = false
  trunks.frustumCulled = true
  canopies.frustumCulled = true

  const dummy = new THREE.Object3D()
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 12) {
    attempts++
    const a = rand() * Math.PI * 2
    // Prefer inland jungle; keep beach mostly clear
    const preferJungle = rand() < 0.82
    const rMin = preferJungle ? 10 : JUNGLE_RADIUS
    const rMax = preferJungle ? JUNGLE_RADIUS : ISLAND_RADIUS * 0.78
    const r = rMin + rand() * Math.max(2, rMax - rMin)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (isClearing(x, z) && preferJungle && rand() < 0.85) continue
    if (z > GATE_Z - 2 && Math.abs(x) < 10) continue
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.45) continue
    if (biomeAt(x, z) === 'sand' && preferJungle) continue

    const h = 4.2 + rand() * 2.4
    const lean = (rand() - 0.5) * 0.18
    const yaw = rand() * Math.PI * 2

    dummy.position.set(x, y, z)
    dummy.rotation.set(lean, yaw, 0)
    dummy.scale.set(1, h, 1)
    dummy.updateMatrix()
    trunks.setMatrixAt(placed, dummy.matrix)

    dummy.position.set(x, y + h * 0.92, z)
    dummy.rotation.set(0, yaw, lean * 0.5)
    const cs = 0.85 + rand() * 0.45
    dummy.scale.set(cs, cs, cs)
    dummy.updateMatrix()
    canopies.setMatrixAt(placed, dummy.matrix)
    placed++
  }
  trunks.count = placed
  canopies.count = placed
  trunks.instanceMatrix.needsUpdate = true
  canopies.instanceMatrix.needsUpdate = true
  group.add(trunks, canopies)
}

function buildCanopyGeometry(software: boolean): THREE.BufferGeometry {
  // Merge a few fronds into one geo so each palm is 1 canopy instance
  const parts: THREE.BufferGeometry[] = []
  const fronds = software ? 4 : 5
  for (let i = 0; i < fronds; i++) {
    const cone = new THREE.ConeGeometry(0.38, 1.9, software ? 4 : 5, 1, true)
    cone.rotateX(Math.PI / 2)
    cone.translate(0, 0, 0.85)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.4, (i / fronds) * Math.PI * 2, 0, 'YXZ'),
    )
    m.makeRotationFromQuaternion(q)
    cone.applyMatrix4(m)
    parts.push(cone)
  }
  const merged = mergeGeos(parts)
  for (const p of parts) p.dispose()
  return merged
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Minimal merge without addons dependency
  let totalVerts = 0
  for (const g of geos) {
    totalVerts += g.attributes.position.count
  }
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const indices: number[] = []
  let vOffset = 0
  for (const g of geos) {
    g.computeVertexNormals()
    const p = g.attributes.position
    const n = g.attributes.normal
    for (let i = 0; i < p.count; i++) {
      positions[(vOffset + i) * 3] = p.getX(i)
      positions[(vOffset + i) * 3 + 1] = p.getY(i)
      positions[(vOffset + i) * 3 + 2] = p.getZ(i)
      normals[(vOffset + i) * 3] = n.getX(i)
      normals[(vOffset + i) * 3 + 1] = n.getY(i)
      normals[(vOffset + i) * 3 + 2] = n.getZ(i)
    }
    const idx = g.index
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOffset)
    } else {
      for (let i = 0; i < p.count; i++) indices.push(vOffset + i)
    }
    vOffset += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  out.setIndex(indices)
  return out
}

function placeInstancedBushes(group: THREE.Group, rand: () => number, count: number) {
  const geo = new THREE.SphereGeometry(0.55, 6, 5)
  const meshA = new THREE.InstancedMesh(geo, BUSH_MAT, count)
  const meshB = new THREE.InstancedMesh(geo, BUSH_MAT_B, count)
  meshA.castShadow = false
  meshB.castShadow = false
  const dummy = new THREE.Object3D()
  let aN = 0
  let bN = 0
  let attempts = 0
  while (aN + bN < count && attempts < count * 10) {
    attempts++
    const a = rand() * Math.PI * 2
    const r = 8 + rand() * (ISLAND_RADIUS * 0.72)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (isClearing(x, z) && rand() < 0.7) continue
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.4) continue
    if (biomeAt(x, z) === 'sand') continue
    dummy.position.set(x, y + 0.35, z)
    dummy.rotation.set(0, rand() * Math.PI * 2, 0)
    const s = 0.7 + rand() * 1.1
    dummy.scale.set(s * (0.9 + rand() * 0.3), s * (0.7 + rand() * 0.4), s * (0.9 + rand() * 0.3))
    dummy.updateMatrix()
    if (rand() < 0.5 && aN < count) {
      meshA.setMatrixAt(aN++, dummy.matrix)
    } else if (bN < count) {
      meshB.setMatrixAt(bN++, dummy.matrix)
    }
  }
  meshA.count = aN
  meshB.count = bN
  meshA.instanceMatrix.needsUpdate = true
  meshB.instanceMatrix.needsUpdate = true
  group.add(meshA, meshB)
}

function placeInstancedRocks(group: THREE.Group, rand: () => number, count: number) {
  const geo = new THREE.DodecahedronGeometry(0.55, 0)
  const mesh = new THREE.InstancedMesh(geo, ROCK_MAT, count)
  mesh.castShadow = false
  mesh.receiveShadow = true
  const dummy = new THREE.Object3D()
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 8) {
    attempts++
    const x = (rand() - 0.5) * ISLAND_RADIUS * 1.7
    const z = (rand() - 0.5) * ISLAND_RADIUS * 1.7
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.25) continue
    dummy.position.set(x, y, z)
    dummy.rotation.set(rand(), rand(), rand())
    dummy.scale.set(0.8 + rand(), 0.5 + rand() * 0.7, 0.8 + rand() * 0.5)
    dummy.updateMatrix()
    mesh.setMatrixAt(placed++, dummy.matrix)
  }
  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
}

function buildGate() {
  const gate = new THREE.Group()
  const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e })
  const half = 7.5
  for (const sx of [-half, half]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 3.6, 0.55), postMat)
    post.position.set(sx, 1.8, 0)
    post.castShadow = true
    gate.add(post)
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.4, 0.28), postMat)
  bar.position.set(0, 2.7, 0)
  gate.add(bar)
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 1.2, 0.12),
    new THREE.MeshLambertMaterial({ color: 0xd7b26a }),
  )
  sign.position.set(0, 1.6, 0.22)
  gate.add(sign)
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, half * 2, 8),
    new THREE.MeshLambertMaterial({ color: 0xc4a35a }),
  )
  rope.rotation.z = Math.PI / 2
  rope.position.set(0, 1.15, 0)
  rope.name = 'gateRope'
  gate.add(rope)
  return gate
}

export function createVendorStand() {
  const g = new THREE.Group()
  const wood = new THREE.MeshLambertMaterial({ color: 0x8b5a2b })
  const cloth = new THREE.MeshLambertMaterial({ color: 0xe4572e })

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

  const items: { color: number; pos: [number, number, number]; geo: THREE.BufferGeometry }[] = [
    { color: 0xe63946, pos: [-0.8, 1.15, 0.15], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 8) },
    { color: 0x457b9d, pos: [-0.5, 1.15, 0.2], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 8) },
    { color: 0x2a9d8f, pos: [-0.2, 1.15, 0.12], geo: new THREE.CylinderGeometry(0.08, 0.1, 0.28, 8) },
    { color: 0x6b3e1e, pos: [0.2, 1.12, 0.2], geo: new THREE.SphereGeometry(0.14, 8, 6) },
    { color: 0xd4a373, pos: [0.55, 1.12, 0.15], geo: new THREE.BoxGeometry(0.22, 0.12, 0.22) },
    { color: 0x48cae4, pos: [0.9, 1.15, 0.18], geo: new THREE.CylinderGeometry(0.07, 0.09, 0.26, 8) },
    { color: 0x0077b6, pos: [1.15, 1.18, 0.05], geo: new THREE.CylinderGeometry(0.1, 0.12, 0.32, 8) },
  ]
  for (const it of items) {
    const m = new THREE.Mesh(it.geo, new THREE.MeshLambertMaterial({ color: it.color }))
    m.position.set(...it.pos)
    m.castShadow = false
    g.add(m)
  }

  const npc = createSimpleVendorNpc()
  npc.position.set(0.1, 0.9, -0.55)
  g.add(npc)

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.5, 0.7),
    new THREE.MeshLambertMaterial({ color: 0xa67c52 }),
  )
  crate.position.set(-1.4, 0.35, 0.5)
  g.add(crate)

  const flagPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 5.2, 8),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2e }),
  )
  flagPole.position.set(1.6, 2.6, 0.6)
  g.add(flagPole)
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshLambertMaterial({ color: 0xf5c518, side: THREE.DoubleSide }),
  )
  flag.position.set(2.35, 4.4, 0.6)
  g.add(flag)

  return g
}

function createSimpleVendorNpc() {
  const g = new THREE.Group()
  const fur = new THREE.MeshLambertMaterial({ color: 0x9a6b3f })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.35, 4, 8), fur)
  body.position.y = 0.45
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), fur)
  head.position.y = 0.95
  g.add(head)
  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.24, 0.12, 10),
    new THREE.MeshLambertMaterial({ color: 0xf5c518 }),
  )
  hat.position.y = 1.12
  g.add(hat)
  return g
}

function spawnFauna(fauna: THREE.Group, rand: () => number, software: boolean) {
  const birdN = software ? 4 : 8
  const crabN = software ? 5 : 10
  const bfN = software ? 4 : 10

  for (let i = 0; i < birdN; i++) {
    const bird = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.28, 5),
      new THREE.MeshLambertMaterial({ color: 0xf1faee }),
    )
    body.rotation.z = Math.PI / 2
    bird.add(body)
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.04, 0.12),
      new THREE.MeshLambertMaterial({ color: 0xe63946 }),
    )
    wing.name = 'wing'
    bird.add(wing)
    bird.position.set((rand() - 0.5) * 160, 8 + rand() * 10, (rand() - 0.5) * 160)
    bird.userData = {
      kind: 'bird',
      phase: rand() * Math.PI * 2,
      radius: 40 + rand() * 50,
      speed: 0.18 + rand() * 0.28,
      height: bird.position.y,
    }
    fauna.add(bird)
  }

  for (let i = 0; i < crabN; i++) {
    const crab = new THREE.Group()
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xe76f51 }),
    )
    shell.scale.set(1.2, 0.55, 1)
    crab.add(shell)
    for (const s of [-1, 1]) {
      const claw = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.05, 0.14),
        new THREE.MeshLambertMaterial({ color: 0xf4a261 }),
      )
      claw.position.set(s * 0.18, 0, 0.12)
      crab.add(claw)
    }
    const a = rand() * Math.PI * 2
    const r = ISLAND_RADIUS * 0.62 + rand() * 14
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    crab.position.set(x, groundHeight(x, z) + 0.08, z)
    crab.userData = { kind: 'crab', phase: rand() * Math.PI * 2, ox: x, oz: z }
    fauna.add(crab)
  }

  for (let i = 0; i < bfN; i++) {
    const bf = new THREE.Group()
    const col = new THREE.Color().setHSL(rand(), 0.75, 0.55)
    const wingL = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 8),
      new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide }),
    )
    wingL.position.x = -0.08
    wingL.name = 'wingL'
    const wingR = wingL.clone()
    wingR.position.x = 0.08
    wingR.name = 'wingR'
    bf.add(wingL, wingR)
    const x = (rand() - 0.5) * JUNGLE_RADIUS * 1.6
    const z = (rand() - 0.5) * JUNGLE_RADIUS * 1.6
    bf.position.set(x, groundHeight(x, z) + 1.2 + rand(), z)
    bf.userData = { kind: 'butterfly', phase: rand() * Math.PI * 2, ox: x, oz: z }
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

const BANANA_MAT = new THREE.MeshLambertMaterial({
  color: 0xffd12a,
  emissive: 0x2a2000,
  emissiveIntensity: 0.2,
})

export function createBananaMesh() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), BANANA_MAT)
  body.rotation.z = 0.85
  body.rotation.x = 0.25
  body.castShadow = false
  g.add(body)
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0x3d2b1f }),
  )
  tip.position.set(-0.12, 0.18, 0.02)
  g.add(tip)
  g.scale.setScalar(1.15)
  return g
}

export function createRaft() {
  const g = new THREE.Group()
  const wood = new THREE.MeshLambertMaterial({ color: 0x8d6b45 })
  for (let i = 0; i < 5; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6), wood)
    log.rotation.z = Math.PI / 2
    log.position.set(0, 0.12, (i - 2) * 0.28)
    log.castShadow = true
    g.add(log)
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), wood)
  mast.position.y = 0.9
  g.add(mast)
  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshLambertMaterial({ color: 0xfff1c9, side: THREE.DoubleSide }),
  )
  sail.position.set(0.35, 1.1, 0)
  g.add(sail)
  return g
}
