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

  // Richer sky: gradient dome + matching fog (cheap MeshBasic)
  const sky = buildSkyDome()
  scene.add(sky)
  scene.background = new THREE.Color(0x6eb8e0)
  scene.fog = new THREE.FogExp2(0xa8d8ec, software ? 0.0075 : 0.0048)

  const hemi = new THREE.HemisphereLight(0xc8eaff, 0x8a6230, 0.92)
  scene.add(hemi)

  const sunLight = new THREE.DirectionalLight(0xffe6b0, 1.65)
  sunLight.position.set(90, 110, 40)
  sunLight.castShadow = !software
  // Small map + tight frustum (updated each few frames to follow player)
  sunLight.shadow.mapSize.set(256, 256)
  sunLight.shadow.camera.near = 10
  sunLight.shadow.camera.far = 220
  const shadowExtent = 48
  sunLight.shadow.camera.left = -shadowExtent
  sunLight.shadow.camera.right = shadowExtent
  sunLight.shadow.camera.top = shadowExtent
  sunLight.shadow.camera.bottom = -shadowExtent
  sunLight.shadow.bias = -0.0012
  sunLight.target.position.set(0, 0, -40)
  scene.add(sunLight)
  scene.add(sunLight.target)

  const fill = new THREE.DirectionalLight(0xa0c8ff, 0.28)
  fill.position.set(-60, 40, -30)
  scene.add(fill)

  const sunGroup = new THREE.Group()
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(10, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
  )
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(18, 12, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffc878,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  )
  const sunHalo = new THREE.Mesh(
    new THREE.SphereGeometry(28, 10, 10),
    new THREE.MeshBasicMaterial({
      color: 0xff9955,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    }),
  )
  sunGroup.add(sunGlow, sunHalo, sun)
  sunGroup.position.set(140, 85, 60)
  scene.add(sunGroup)
  scene.add(new THREE.AmbientLight(0xfff6e8, 0.32))

  // Terrain covers main + sister island (centered toward the channel)
  const seg = software ? 64 : 88
  const size = 560
  const geo = new THREE.PlaneGeometry(size, size, seg, seg)
  geo.rotateX(-Math.PI / 2)
  geo.translate(SECOND_ISLAND.x * 0.35, 0, 0)
  const pos = geo.attributes.position
  const colors: number[] = []
  // Strong sand ↔ jungle contrast so the island doesn't read as one green field
  const sand = new THREE.Color(0xf0d4a0)
  const brightSand = new THREE.Color(0xf7e4bc)
  const wetSand = new THREE.Color(0xc9a06a)
  const grassA = new THREE.Color(0x7ec24e)
  const grassB = new THREE.Color(0x4fa84a)
  const grassC = new THREE.Color(0x358a3a)
  const grassD = new THREE.Color(0xa0c85a)
  const jungle = new THREE.Color(0x1c6b2e)
  const jungleDeep = new THREE.Color(0x0e3d1c)
  const jungleMoss = new THREE.Color(0x2f7a3a)
  const jungleOlive = new THREE.Color(0x4a6b28)
  const rock = new THREE.Color(0x6f6860)
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = groundHeight(x, z)
    pos.setY(i, y)
    const biome = biomeAt(x, z)
    const n =
      (Math.sin(x * 0.11 + z * 0.07) * 0.5 + 0.5) * 0.5 +
      (Math.sin(x * 0.31 - z * 0.23) * 0.5 + 0.5) * 0.35 +
      (Math.sin(x * 0.55 + z * 0.41) * 0.5 + 0.5) * 0.15
    if (y < WATER_LEVEL + 0.28) c.copy(wetSand)
    else if (biome === 'sand') {
      c.copy(sand).lerp(brightSand, n)
      // Warm rim near water
      if (y < WATER_LEVEL + 0.9) c.lerp(wetSand, 0.35)
    } else if (biome === 'rock') c.copy(rock).offsetHSL(0, 0, (n - 0.5) * 0.08)
    else if (biome === 'jungle') {
      c.copy(jungle).lerp(jungleDeep, Math.min(1, (y - 0.5) / 4.5))
      c.lerp(n > 0.55 ? jungleMoss : jungleOlive, 0.25 + n * 0.35)
    } else {
      if (n < 0.22) c.copy(grassA)
      else if (n < 0.48) c.copy(grassB)
      else if (n < 0.72) c.copy(grassC)
      else c.copy(grassD)
      // Soft blend toward jungle only near the canopy edge
      const r = Math.hypot(x, z)
      const edge = Math.max(0, 1 - Math.abs(r - JUNGLE_RADIUS) / 18)
      c.lerp(jungle, edge * 0.35)
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

  // Ocean — Lambert + light GPU waves (avoid MeshStandard fill cost)
  const oceanSeg = software ? 1 : 14
  const oceanGeo = new THREE.PlaneGeometry(1400, 1400, oceanSeg, oceanSeg)
  oceanGeo.rotateX(-Math.PI / 2)
  const oceanMat = new THREE.MeshLambertMaterial({
    color: 0x1a8fb0,
    transparent: true,
    opacity: 0.9,
  })
  if (!software) {
    oceanMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += sin(position.x * 0.055 + uTime * 1.3) * 0.12
                        + cos(position.z * 0.045 + uTime * 1.05) * 0.09;`,
      )
      oceanMat.userData.shader = shader
    }
    oceanMat.customProgramCacheKey = () => 'monkey-ocean-lambert-v1'
  }
  const ocean = new THREE.Mesh(oceanGeo, oceanMat)
  ocean.position.y = WATER_LEVEL
  ocean.receiveShadow = false
  group.add(ocean)

  const horizon = new THREE.Mesh(
    new THREE.RingGeometry(380, 720, 32),
    new THREE.MeshBasicMaterial({
      color: 0x7ec4dc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.28,
    }),
  )
  horizon.rotation.x = -Math.PI / 2
  horizon.position.y = WATER_LEVEL + 0.02
  group.add(horizon)

  const rand = mulberry32(42)
  const trees: THREE.Object3D[] = []

  const colliders: Collider[] = []

  // Instanced jungle — density kept, cost capped vs prior 700/180
  const palmCount = software ? 180 : 480
  const bushCount = software ? 80 : 160
  const rockCount = software ? 16 : 36
  placeInstancedPalms(group, rand, palmCount, software, colliders)
  placeInstancedBushes(group, rand, bushCount, software, colliders)
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

  // Dedicated short courses → banana clusters (jump or skirt)
  placeObstacleCourses(group, bananaPositions, colliders, rand, pushBanana)

  // Keep pickups outside existing solids so contact collection is reachable
  for (const b of bananaPositions) clearPointFromColliders(b, colliders, 0.95)

  // Light rings on some remaining bananas (never seal)
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

  // Several canopy silhouettes + greens (few draws, still instanced)
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
    {
      geo: buildCanopyGeometry(software, 'fan'),
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
    new THREE.Color(0x8fc65a), // chartreuse tips
    new THREE.Color(0x165c28), // deep shade
    new THREE.Color(0x5a9a38), // olive
    new THREE.Color(0x3db86a), // teal-green
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
    // Keep the south spawn pad clear so the monkey doesn't start inside a trunk
    if (Math.hypot(x - 0, z - (-70)) < 5.5) continue

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

function buildSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(520, 24, 12)
  const cols = new Float32Array(geo.attributes.position.count * 3)
  const zenith = new THREE.Color(0x3a8fd4)
  const mid = new THREE.Color(0x7ec4e8)
  const horizon = new THREE.Color(0xf2c9a0)
  const c = new THREE.Color()
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 520
    const t = Math.min(1, Math.max(0, y * 0.55 + 0.45))
    if (t < 0.35) c.copy(horizon).lerp(mid, t / 0.35)
    else c.copy(mid).lerp(zenith, (t - 0.35) / 0.65)
    cols[i * 3] = c.r
    cols[i * 3 + 1] = c.g
    cols[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

function buildCanopyGeometry(
  software: boolean,
  style: 'spread' | 'droop' | 'bushy' | 'round' | 'fan',
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const segs = software ? 4 : 5
  if (style === 'round') {
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SphereGeometry(0.55 + (i % 2) * 0.15, segs, segs - 1)
      s.translate((i - 1.5) * 0.25, 0.15, ((i * 0.7) % 2) * 0.2 - 0.1)
      parts.push(s)
    }
  } else if (style === 'fan') {
    const fronds = software ? 5 : 6
    for (let i = 0; i < fronds; i++) {
      const blade = new THREE.ConeGeometry(0.22, 2.4, segs, 1, true)
      blade.rotateX(Math.PI / 2 + 0.15)
      blade.translate(0, 0.1, 1.05)
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0.25, (i / fronds) * Math.PI * 1.1 - 0.55, 0.1, 'YXZ'),
      )
      m.makeRotationFromQuaternion(q)
      blade.applyMatrix4(m)
      parts.push(blade)
    }
  } else {
    const fronds = style === 'bushy' ? (software ? 5 : 6) : software ? 4 : 5
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
  software: boolean,
  colliders: Collider[],
) {
  // Two bush silhouettes so the undergrowth isn't identical spheres
  const kinds = [
    {
      geo: new THREE.SphereGeometry(0.55, software ? 5 : 6, software ? 4 : 5),
      baseR: 0.55,
    },
    {
      geo: (() => {
        const a = new THREE.SphereGeometry(0.42, software ? 5 : 6, 4)
        const b = new THREE.SphereGeometry(0.36, software ? 5 : 6, 4)
        b.translate(0.28, 0.1, -0.1)
        const c = new THREE.SphereGeometry(0.3, 5, 4)
        c.translate(-0.22, 0.05, 0.18)
        const merged = mergeGeos([a, b, c])
        a.dispose()
        b.dispose()
        c.dispose()
        return merged
      })(),
      baseR: 0.62,
    },
  ]
  const mats = kinds.map(
    () => new THREE.MeshLambertMaterial({ color: 0xffffff }),
  )
  const meshes = kinds.map(
    (k, i) => new THREE.InstancedMesh(k.geo, mats[i], Math.ceil(count * 0.6)),
  )
  for (const m of meshes) {
    m.castShadow = false
    m.frustumCulled = true
  }
  const counts = meshes.map(() => 0)
  const greens = [
    new THREE.Color(0x2d7a38),
    new THREE.Color(0x3a9144),
    new THREE.Color(0x1f6b30),
    new THREE.Color(0x55a84a),
    new THREE.Color(0x458a3a),
    new THREE.Color(0x6aad52),
    new THREE.Color(0x8fbf48),
    new THREE.Color(0x245c2e),
    new THREE.Color(0x4a7a28),
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
    if (Math.hypot(x, z + 70) < 5.5) continue
    const kind = rand() < 0.55 ? 0 : 1
    if (counts[kind] >= meshes[kind].count) continue
    dummy.position.set(x, y + 0.2 + rand() * 0.35, z)
    dummy.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.3)
    const s = 0.35 + rand() * 1.85
    const sx = s * (0.85 + rand() * 0.4)
    const sy = s * (0.55 + rand() * 0.7)
    const sz = s * (0.85 + rand() * 0.4)
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    const ci = counts[kind]
    meshes[kind].setMatrixAt(ci, dummy.matrix)
    color.copy(greens[Math.floor(rand() * greens.length)])
    meshes[kind].setColorAt(ci, color)
    counts[kind]++
    colliders.push({ x, z, r: kinds[kind].baseR * Math.max(sx, sz) + 0.35 })
    placed++
  }
  meshes.forEach((mesh, i) => {
    mesh.count = counts[i]
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    group.add(mesh)
  })
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

type ObstacleKit = {
  crateGeo: THREE.BufferGeometry
  stumpGeo: THREE.BufferGeometry
  logGeo: THREE.BufferGeometry
  rockGeo: THREE.BufferGeometry
  crateMat: THREE.Material
  stumpMat: THREE.Material
  logMat: THREE.Material
  rockMat: THREE.Material
}

function makeObstacleKit(): ObstacleKit {
  const crateGeo = new THREE.BoxGeometry(1.05, 0.9, 1.05)
  crateGeo.translate(0, 0.45, 0)
  const stumpGeo = new THREE.CylinderGeometry(0.38, 0.45, 0.75, 6)
  stumpGeo.translate(0, 0.38, 0)
  const logGeo = new THREE.CylinderGeometry(0.32, 0.36, 2.2, 6)
  logGeo.rotateZ(Math.PI / 2)
  logGeo.translate(0, 0.34, 0)
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0)
  return {
    crateGeo,
    stumpGeo,
    logGeo,
    rockGeo,
    crateMat: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
    stumpMat: new THREE.MeshLambertMaterial({ color: 0x6b4a2e }),
    logMat: new THREE.MeshLambertMaterial({ color: 0x7a5a38 }),
    rockMat: new THREE.MeshLambertMaterial({ color: 0x6e675c }),
  }
}

function addSolidProp(
  group: THREE.Group,
  colliders: Collider[],
  kit: ObstacleKit,
  kind: 'crate' | 'stump' | 'log' | 'rock',
  x: number,
  z: number,
  yaw = 0,
) {
  const y = groundHeight(x, z)
  if (y < WATER_LEVEL + 0.25) return false
  const geo =
    kind === 'crate' ? kit.crateGeo : kind === 'stump' ? kit.stumpGeo : kind === 'log' ? kit.logGeo : kit.rockGeo
  const mat =
    kind === 'crate' ? kit.crateMat : kind === 'stump' ? kit.stumpMat : kind === 'log' ? kit.logMat : kit.rockMat
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.rotation.y = yaw
  mesh.castShadow = false
  mesh.receiveShadow = false
  group.add(mesh)
  const r = kind === 'crate' ? 0.78 : kind === 'log' ? 1.15 : kind === 'rock' ? 0.65 : 0.55
  colliders.push({ x, z, r })
  return true
}

/**
 * Several short courses: jump crates/logs/rocks or skirt the gaps to reach banana clusters.
 * Courses are linear-ish with intentional openings — never an unsolvable wall.
 */
function placeObstacleCourses(
  group: THREE.Group,
  _bananas: THREE.Vector3[],
  colliders: Collider[],
  rand: () => number,
  pushBanana: (x: number, z: number) => void,
) {
  const kit = makeObstacleKit()

  type Course = {
    /** Approach direction (unit-ish). */
    ax: number
    az: number
    /** Start of the course (player approaches toward +ax,+az). */
    sx: number
    sz: number
    steps: number
    spacing: number
    pattern: Array<'crate' | 'stump' | 'log' | 'rock' | 'gap'>
  }

  const courses: Course[] = [
    // East of spawn — crate hop → cluster
    {
      sx: 8,
      sz: -62,
      ax: 0.95,
      az: 0.25,
      steps: 5,
      spacing: 2.35,
      pattern: ['crate', 'gap', 'crate', 'log', 'gap'],
    },
    // West toward vendor — rock / stump weave
    {
      sx: -10,
      sz: -58,
      ax: -0.9,
      az: 0.35,
      steps: 6,
      spacing: 2.2,
      pattern: ['rock', 'gap', 'stump', 'rock', 'gap', 'crate'],
    },
    // Inland south jungle — log lane
    {
      sx: 4,
      sz: -42,
      ax: 0.15,
      az: 1,
      steps: 6,
      spacing: 2.5,
      pattern: ['log', 'gap', 'crate', 'log', 'gap', 'stump'],
    },
    // Gate approach (south of cove) — mixed
    {
      sx: -6,
      sz: 28,
      ax: 0.1,
      az: 1,
      steps: 5,
      spacing: 2.4,
      pattern: ['crate', 'rock', 'gap', 'log', 'gap'],
    },
    // NE beach fringe — skirtable rocks
    {
      sx: 48,
      sz: -18,
      ax: 0.7,
      az: 0.7,
      steps: 5,
      spacing: 2.3,
      pattern: ['rock', 'gap', 'rock', 'stump', 'gap'],
    },
    // Sister island landing reward course (raft players)
    {
      sx: SECOND_ISLAND.x - 14,
      sz: SECOND_ISLAND.z - 4,
      ax: 1,
      az: 0.15,
      steps: 5,
      spacing: 2.4,
      pattern: ['crate', 'gap', 'log', 'gap', 'rock'],
    },
  ]

  for (const course of courses) {
    const len = Math.hypot(course.ax, course.az) || 1
    const ux = course.ax / len
    const uz = course.az / len
    const px = -uz // perpendicular for side offsets / gaps
    const pz = ux

    for (let i = 0; i < course.steps; i++) {
      const kind = course.pattern[i % course.pattern.length]
      const x = course.sx + ux * i * course.spacing
      const z = course.sz + uz * i * course.spacing
      if (kind === 'gap') continue
      // Slight side jitter so courses aren't ruler-straight walls
      const side = (rand() - 0.5) * 0.55
      addSolidProp(group, colliders, kit, kind, x + px * side, z + pz * side, rand() * Math.PI)
      // Optional twin piece on the other side with a clear middle gap to walk
      if (kind === 'crate' || kind === 'rock') {
        if (rand() < 0.55) {
          addSolidProp(
            group,
            colliders,
            kit,
            kind === 'crate' ? 'stump' : 'rock',
            x + px * (1.55 + rand() * 0.25),
            z + pz * (1.55 + rand() * 0.25),
            rand() * Math.PI,
          )
        }
      }
    }

    // Banana cluster at the end of the course (+ one mid reward)
    const endX = course.sx + ux * course.steps * course.spacing
    const endZ = course.sz + uz * course.steps * course.spacing
    const midX = course.sx + ux * (course.steps * 0.55) * course.spacing
    const midZ = course.sz + uz * (course.steps * 0.55) * course.spacing
    pushBanana(midX + px * 0.4, midZ + pz * 0.4)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rand() * 0.2
      pushBanana(endX + Math.cos(a) * (1.1 + rand() * 0.7), endZ + Math.sin(a) * (1.1 + rand() * 0.7))
    }
    // Open approach marker stump offset — does not block the last gap
    addSolidProp(group, colliders, kit, 'stump', endX - ux * 1.2 + px * 2.1, endZ - uz * 1.2 + pz * 2.1, 0)
  }
}

/**
 * Light partial rings on some bananas. Always leaves a walk-around gap;
 * crates are short enough to jump (~0.8–1.0m).
 */
function placeBananaObstacles(
  group: THREE.Group,
  bananas: THREE.Vector3[],
  colliders: Collider[],
  rand: () => number,
) {
  const kit = makeObstacleKit()
  const maxObstacles = Math.min(bananas.length, 70)
  let placed = 0
  for (let i = 0; i < bananas.length && placed < maxObstacles; i++) {
    if (i < 4) continue
    if (rand() > 0.42) continue

    const b = bananas[i]
    const open = rand() * Math.PI * 2
    const pieces = 2 + (rand() < 0.35 ? 1 : 0)
    const radius = 1.4 + rand() * 0.4
    for (let k = 0; k < pieces; k++) {
      const a = open + 1.2 + k * 0.95
      const x = b.x + Math.cos(a) * radius
      const z = b.z + Math.sin(a) * radius
      const kind = rand() < 0.5 ? 'crate' : rand() < 0.5 ? 'stump' : 'rock'
      if (addSolidProp(group, colliders, kit, kind, x, z, rand() * Math.PI)) placed++
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
    if (Math.hypot(x, z + 70) < 5.5) continue
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
