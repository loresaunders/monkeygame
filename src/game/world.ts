import * as THREE from 'three'
import {
  biomeAt,
  groundHeight,
  GATE_Z,
  ISLAND_RADIUS,
  JUNGLE_RADIUS,
  SECOND_ISLAND,
  WATER_LEVEL,
  isClearing,
} from './terrain'

export interface Collider {
  x: number
  z: number
  r: number
}

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
  bananaInstances: THREE.InstancedMesh | null
  trees: THREE.Object3D[]
  sunLight: THREE.DirectionalLight
  colliders: Collider[]
}

const PALM_TRUNK_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff })
const ROCK_MAT = new THREE.MeshLambertMaterial({ color: 0x7d766c })
const BANANA_MAT = new THREE.MeshLambertMaterial({
  color: 0xffd12a,
  emissive: 0x2a2000,
  emissiveIntensity: 0.18,
})

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
  sunLight.shadow.mapSize.set(512, 512)
  sunLight.shadow.camera.near = 2
  sunLight.shadow.camera.far = 420
  const shadowExtent = 200
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.28))

  // Terrain covers main + sister island (centered toward the channel)
  const seg = software ? 72 : 110
  const size = 560
  const geo = new THREE.PlaneGeometry(size, size, seg, seg)
  geo.rotateX(-Math.PI / 2)
  geo.translate(SECOND_ISLAND.x * 0.35, 0, 0)
  const pos = geo.attributes.position
  const colors: number[] = []
  const sand = new THREE.Color(0xedcfa0)
  const wetSand = new THREE.Color(0xd4b078)
  const grassA = new THREE.Color(0x6bb84a) // lime
  const grassB = new THREE.Color(0x3f9a4a) // mid
  const grassC = new THREE.Color(0x2d7a3c) // deep
  const grassD = new THREE.Color(0x8fbf4a) // yellow-green
  const jungle = new THREE.Color(0x247a38)
  const jungleDeep = new THREE.Color(0x145226)
  const jungleMoss = new THREE.Color(0x3a8f4a)
  const rock = new THREE.Color(0x7a7368)
  const c = new THREE.Color()
  const tmpC = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = groundHeight(x, z)
    pos.setY(i, y)
    const biome = biomeAt(x, z)
    const n = (Math.sin(x * 0.11 + z * 0.07) * 0.5 + 0.5) * 0.55 + (Math.sin(x * 0.31 - z * 0.23) * 0.5 + 0.5) * 0.45
    if (y < WATER_LEVEL + 0.28) c.copy(wetSand)
    else if (biome === 'sand') c.copy(sand)
    else if (biome === 'rock') c.copy(rock)
    else if (biome === 'jungle') {
      c.copy(jungle).lerp(jungleDeep, Math.min(1, (y - 0.6) / 5))
      c.lerp(jungleMoss, n * 0.45)
    } else {
      // Mixed grass shades — not one flat green field
      if (n < 0.28) c.copy(grassA)
      else if (n < 0.55) c.copy(grassB)
      else if (n < 0.78) c.copy(grassC)
      else c.copy(grassD)
      c.lerp(jungle, 0.15 + n * 0.2)
      tmpC.copy(c)
    }
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
  const oceanSeg = software ? 1 : 24
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

  const colliders: Collider[] = []

  // --- Instanced jungle (5× trees vs prior 140; 180 bushes) ---
  const palmCount = software ? 200 : 700
  const bushCount = software ? 90 : 180
  const rockCount = software ? 18 : 40
  placeInstancedPalms(group, rand, palmCount, software, colliders)
  placeInstancedBushes(group, rand, bushCount, colliders)
  placeInstancedRocks(group, rand, rockCount, colliders)

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
  colliders.push({ x: vx, z: vz, r: 2.4 })
  colliders.push({ x: vx + 1.6, z: vz + 0.6, r: 0.6 }) // flag pole

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
  // Sister island stash (raft voyage reward)
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2
    const r = 6 + rand() * (SECOND_ISLAND.radius * 0.7)
    pushBanana(SECOND_ISLAND.x + Math.cos(a) * r, SECOND_ISLAND.z + Math.sin(a) * r)
  }

  // Keep pickups outside existing solids so contact collection is reachable
  for (const b of bananaPositions) clearPointFromColliders(b, colliders, 0.95)

  // Partial rings / crates — go around or jump; never seal bananas in
  placeBananaObstacles(group, bananaPositions, colliders, rand)

  const bananaInstances = createBananaInstances(group, bananaPositions)

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
    bananaInstances,
    trees,
    sunLight,
    colliders,
  }
}

function placeInstancedPalms(
  group: THREE.Group,
  rand: () => number,
  count: number,
  software: boolean,
  colliders: Collider[],
) {
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.28, 1, software ? 5 : 6)
  trunkGeo.translate(0, 0.5, 0)

  // Several canopy silhouettes + greens (separate draws, still tiny vs per-tree meshes)
  const canopyKinds: { geo: THREE.BufferGeometry; mat: THREE.MeshLambertMaterial }[] = [
    {
      geo: buildCanopyGeometry(software, 'spread'),
      mat: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    },
    {
      geo: buildCanopyGeometry(software, 'droop'),
      mat: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    },
    {
      geo: buildCanopyGeometry(software, 'bushy'),
      mat: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    },
    {
      geo: buildCanopyGeometry(software, 'round'),
      mat: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    },
  ]

  const trunks = new THREE.InstancedMesh(trunkGeo, PALM_TRUNK_MAT, count)
  trunks.castShadow = false // shadow budget: player only
  trunks.receiveShadow = false
  trunks.frustumCulled = true

  const canopyMeshes = canopyKinds.map((k) => new THREE.InstancedMesh(k.geo, k.mat, count))
  for (const m of canopyMeshes) {
    m.castShadow = false
    m.receiveShadow = false
    m.frustumCulled = true
  }
  const canopyCounts = canopyMeshes.map(() => 0)

  const trunkBrown = [
    new THREE.Color(0x8a6a3d),
    new THREE.Color(0x6e5230),
    new THREE.Color(0xa07848),
    new THREE.Color(0x5c4024),
  ]
  const leafGreens = [
    new THREE.Color(0x2f9a44),
    new THREE.Color(0x1f7a34),
    new THREE.Color(0x4aad52),
    new THREE.Color(0x3a8f3a),
    new THREE.Color(0x6bb85a),
    new THREE.Color(0x247a40),
  ]

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const placedXZ: { x: number; z: number }[] = []
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 20) {
    attempts++
    // ~18% of trees on the sister island
    const onSister = rand() < 0.18
    let x: number
    let z: number
    if (onSister) {
      const a = rand() * Math.PI * 2
      const r = 8 + rand() * (SECOND_ISLAND.radius * 0.72)
      x = SECOND_ISLAND.x + Math.cos(a) * r
      z = SECOND_ISLAND.z + Math.sin(a) * r
    } else {
      const a = rand() * Math.PI * 2
      const preferJungle = rand() < 0.84
      const rMin = preferJungle ? 10 : JUNGLE_RADIUS
      const rMax = preferJungle ? JUNGLE_RADIUS : ISLAND_RADIUS * 0.78
      const r = rMin + rand() * Math.max(2, rMax - rMin)
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      if (z > GATE_Z - 2 && Math.abs(x) < 10) continue
    }
    if (isClearing(x, z) && rand() < 0.82) continue
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.45) continue
    if (biomeAt(x, z) === 'sand' && rand() < 0.9) continue

    // Keep trunks from stacking — overlapping solids made the player embed
    let tooClose = false
    for (const p of placedXZ) {
      if (Math.hypot(x - p.x, z - p.z) < 2.15) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    // Varied height, lean, and trunk thickness (not parade of identical poles)
    const h = 3.2 + rand() * 4.6
    const leanX = (rand() - 0.5) * 0.42
    const leanZ = (rand() - 0.5) * 0.2
    const yaw = rand() * Math.PI * 2
    const thick = 0.65 + rand() * 0.95

    dummy.position.set(x, y, z)
    dummy.rotation.set(leanX, yaw, leanZ)
    dummy.scale.set(thick, h, thick)
    dummy.updateMatrix()
    trunks.setMatrixAt(placed, dummy.matrix)
    color.copy(trunkBrown[Math.floor(rand() * trunkBrown.length)])
    trunks.setColorAt(placed, color)

    // Collider must cover the leaned trunk at monkey height, not just the base pole.
    // CylinderGeometry bottom radius is 0.28; scale.x/z = thick.
    const trunkBaseR = 0.28 * thick
    const leanMag = Math.hypot(leanX, leanZ)
    const leanReach = Math.sin(leanMag) * Math.min(h * 0.5, 1.7)
    colliders.push({ x, z, r: trunkBaseR + leanReach + 0.7 })
    placedXZ.push({ x, z })

    const kind = Math.floor(rand() * canopyMeshes.length)
    const ci = canopyCounts[kind]
    if (ci < canopyMeshes[kind].count) {
      dummy.position.set(x + leanX * h * 0.35, y + h * (0.88 + rand() * 0.08), z + leanZ * h * 0.35)
      dummy.rotation.set(leanX * 0.4, yaw + rand() * 0.8, leanZ * 0.4)
      const cs = 0.7 + rand() * 0.9
      const csY = 0.75 + rand() * 0.7
      dummy.scale.set(cs, csY, cs)
      dummy.updateMatrix()
      canopyMeshes[kind].setMatrixAt(ci, dummy.matrix)
      color.copy(leafGreens[Math.floor(rand() * leafGreens.length)])
      canopyMeshes[kind].setColorAt(ci, color)
      canopyCounts[kind] = ci + 1
    }
    placed++
  }
  trunks.count = placed
  trunks.instanceMatrix.needsUpdate = true
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true
  group.add(trunks)
  canopyMeshes.forEach((m, i) => {
    m.count = canopyCounts[i]
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    group.add(m)
  })
}

function buildCanopyGeometry(
  software: boolean,
  style: 'spread' | 'droop' | 'bushy' | 'round',
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const segs = software ? 4 : 5
  if (style === 'round') {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SphereGeometry(0.55 + (i % 2) * 0.15, segs, segs - 1)
      s.translate((i - 1.5) * 0.25, 0.15, ((i * 0.7) % 2) * 0.2 - 0.1)
      parts.push(s)
    }
  } else {
    const fronds = style === 'bushy' ? (software ? 5 : 7) : software ? 4 : 5
    const droop = style === 'droop' ? 0.85 : style === 'bushy' ? 0.35 : 0.48
    const len = style === 'bushy' ? 1.35 : style === 'droop' ? 2.2 : 1.85
    const rad = style === 'bushy' ? 0.42 : 0.36
    for (let i = 0; i < fronds; i++) {
      const cone = new THREE.ConeGeometry(rad, len, segs, 1, true)
      cone.rotateX(Math.PI / 2)
      cone.translate(0, 0, len * 0.42)
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(droop + (i % 3) * 0.06, (i / fronds) * Math.PI * 2, 0, 'YXZ'),
      )
      m.makeRotationFromQuaternion(q)
      cone.applyMatrix4(m)
      parts.push(cone)
    }
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

function placeInstancedBushes(
  group: THREE.Group,
  rand: () => number,
  count: number,
  colliders: Collider[],
) {
  const geo = new THREE.SphereGeometry(0.55, 6, 5)
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.castShadow = false
  const greens = [
    new THREE.Color(0x2d7a38),
    new THREE.Color(0x3a9144),
    new THREE.Color(0x1f6b30),
    new THREE.Color(0x55a84a),
    new THREE.Color(0x458a3a),
    new THREE.Color(0x6aad52),
  ]
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 14) {
    attempts++
    const onSister = rand() < 0.2
    let x: number
    let z: number
    if (onSister) {
      const a = rand() * Math.PI * 2
      const r = 6 + rand() * (SECOND_ISLAND.radius * 0.7)
      x = SECOND_ISLAND.x + Math.cos(a) * r
      z = SECOND_ISLAND.z + Math.sin(a) * r
    } else {
      const a = rand() * Math.PI * 2
      const r = 8 + rand() * (ISLAND_RADIUS * 0.72)
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    }
    if (isClearing(x, z) && rand() < 0.72) continue
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.4) continue
    if (biomeAt(x, z) === 'sand') continue
    dummy.position.set(x, y + 0.2 + rand() * 0.35, z)
    dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.3)
    const s = 0.35 + rand() * 1.85
    const sx = s * (0.85 + rand() * 0.4)
    const sy = s * (0.55 + rand() * 0.7)
    const sz = s * (0.85 + rand() * 0.4)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    mesh.setMatrixAt(placed, dummy.matrix)
    color.copy(greens[Math.floor(rand() * greens.length)])
    mesh.setColorAt(placed, color)
    // SphereGeometry radius 0.55 × horizontal scale
    colliders.push({ x, z, r: 0.55 * Math.max(sx, sz) + 0.35 })
    placed++
  }
  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  group.add(mesh)
}

/** Push a point outside overlapping cylinder colliders (keeps bananas reachable). */
function clearPointFromColliders(pos: THREE.Vector3, colliders: Collider[], pad: number) {
  for (let pass = 0; pass < 8; pass++) {
    let hit = false
    for (const c of colliders) {
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const d = Math.hypot(dx, dz)
      const min = c.r + pad
      if (d >= min) continue
      hit = true
      if (d > 1e-6) {
        const s = min / d
        pos.x = c.x + dx * s
        pos.z = c.z + dz * s
      } else {
        pos.x = c.x + min
        pos.z = c.z
      }
      pos.y = groundHeight(pos.x, pos.z) + 0.35
    }
    if (!hit) return
  }
}

/**
 * Small solid props near many bananas. Always leaves a walk-around gap;
 * crates are short enough to jump (~0.8–1.0m).
 */
function placeBananaObstacles(
  group: THREE.Group,
  bananas: THREE.Vector3[],
  colliders: Collider[],
  rand: () => number,
) {
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b })
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6e675c })
  const crateGeo = new THREE.BoxGeometry(1.05, 0.9, 1.05)
  crateGeo.translate(0, 0.45, 0)
  const stumpGeo = new THREE.CylinderGeometry(0.38, 0.45, 0.7, 6)
  stumpGeo.translate(0, 0.35, 0)

  const maxObstacles = Math.min(bananas.length, 120)
  let placed = 0
  for (let i = 0; i < bananas.length && placed < maxObstacles; i++) {
    // Leave the first few spawn bananas wide open so early pickup is obvious
    if (i < 3) continue
    if (rand() > 0.62) continue

    const b = bananas[i]
    const open = rand() * Math.PI * 2 // gap facing this angle — always walkable
    const pieces = 2 + (rand() < 0.45 ? 1 : 0)
    const radius = 1.35 + rand() * 0.45
    for (let k = 0; k < pieces; k++) {
      // Spread ~0.85 rad each, leaving ≥1.2 rad open
      const a = open + 1.15 + k * 0.9
      const x = b.x + Math.cos(a) * radius
      const z = b.z + Math.sin(a) * radius
      const y = groundHeight(x, z)
      if (y < WATER_LEVEL + 0.3) continue

      const useCrate = rand() < 0.55
      const mesh = new THREE.Mesh(useCrate ? crateGeo : stumpGeo, useCrate ? crateMat : stoneMat)
      mesh.position.set(x, y, z)
      mesh.rotation.y = rand() * Math.PI * 2
      mesh.castShadow = false
      mesh.receiveShadow = false
      group.add(mesh)
      // Jumpable / skirtable — radius matches the prop footprint
      colliders.push({ x, z, r: useCrate ? 0.75 : 0.55 })
      placed++
    }
  }
}

function createBananaInstances(group: THREE.Group, positions: THREE.Vector3[]) {
  const geo = new THREE.CapsuleGeometry(0.09, 0.3, 3, 6)
  const mesh = new THREE.InstancedMesh(geo, BANANA_MAT, positions.length)
  mesh.castShadow = false
  const dummy = new THREE.Object3D()
  positions.forEach((p, i) => {
    dummy.position.copy(p)
    dummy.rotation.set(0.25, i * 0.7, 0.85)
    dummy.scale.setScalar(1.15)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
  return mesh
}

function placeInstancedRocks(
  group: THREE.Group,
  rand: () => number,
  count: number,
  colliders: Collider[],
) {
  const geo = new THREE.DodecahedronGeometry(0.55, 0)
  const mesh = new THREE.InstancedMesh(geo, ROCK_MAT, count)
  mesh.castShadow = false
  mesh.receiveShadow = true
  const dummy = new THREE.Object3D()
  let placed = 0
  let attempts = 0
  while (placed < count && attempts < count * 10) {
    attempts++
    const onSister = rand() < 0.25
    let x: number
    let z: number
    if (onSister) {
      x = SECOND_ISLAND.x + (rand() - 0.5) * SECOND_ISLAND.radius * 1.5
      z = SECOND_ISLAND.z + (rand() - 0.5) * SECOND_ISLAND.radius * 1.5
    } else {
      x = (rand() - 0.5) * ISLAND_RADIUS * 1.7
      z = (rand() - 0.5) * ISLAND_RADIUS * 1.7
    }
    const y = groundHeight(x, z)
    if (y < WATER_LEVEL + 0.25) continue
    const sx = 0.8 + rand()
    const sz = 0.8 + rand() * 0.5
    dummy.position.set(x, y, z)
    dummy.rotation.set(rand(), rand(), rand())
    dummy.scale.set(sx, 0.5 + rand() * 0.7, sz)
    dummy.updateMatrix()
    mesh.setMatrixAt(placed, dummy.matrix)
    // DodecahedronGeometry radius 0.55 × scale
    colliders.push({ x, z, r: 0.55 * Math.max(sx, sz) + 0.4 })
    placed++
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
    post.castShadow = false
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
  counter.castShadow = false
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

export function createBananaMesh() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 3, 6), BANANA_MAT)
  body.rotation.z = 0.85
  body.rotation.x = 0.25
  g.add(body)
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
    log.castShadow = false
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
