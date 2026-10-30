/** Island terrain helpers — units roughly meters. Scaled ~3× from the original slice. */

export const ISLAND_RADIUS = 126
export const WATER_LEVEL = 0.15
/** North Cove gate — scaled with the larger island. */
export const GATE_Z = 54
/** Soft beach band starts outside this fraction of radius. */
export const JUNGLE_RADIUS = ISLAND_RADIUS * 0.62

/** Sister island — east of the main landmass, raft-only access. */
export const SECOND_ISLAND = { x: 216, z: 12, radius: 52 }

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise2(x: number, z: number) {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const a = hash2(xi, zi)
  const b = hash2(xi + 1, zi)
  const c = hash2(xi, zi + 1)
  const d = hash2(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

export function fbm(x: number, z: number) {
  let amp = 0.5
  let freq = 1
  let sum = 0
  for (let i = 0; i < 4; i++) {
    sum += amp * noise2(x * freq, z * freq)
    amp *= 0.5
    freq *= 2.03
  }
  return sum
}

function radialIslandHeight(
  lx: number,
  lz: number,
  radius: number,
  seed: number,
  opts?: { northCove?: boolean },
): number {
  const r = Math.hypot(lx, lz)
  const radial = 1 - smoothstep(radius * 0.72, radius, r)
  if (radial <= 0.001) return -1.8

  const n = fbm(lx * 0.015 + seed, lz * 0.015 + seed * 0.7)
  const hills = fbm(lx * 0.03 + 20 + seed, lz * 0.03 - 8) * 2.8
  const ridge = Math.max(0, 1.8 - Math.hypot(lx + 18, lz - 12) * 0.06) * 4.2
  let northRise = 0
  let coveBowl = 0
  if (opts?.northCove) {
    northRise = smoothstep(24, 84, lz) * 2.4
    coveBowl =
      -smoothstep(GATE_Z - 6, GATE_Z + 28, lz) * Math.max(0, 1 - Math.abs(lx) / 28) * 1.4
  } else {
    northRise = smoothstep(radius * 0.1, radius * 0.55, lz + radius * 0.2) * 1.6
  }

  let h = 0.4 + n * 2.1 + hills * 0.55 + ridge * (opts?.northCove ? 1 : 0.55) + northRise + coveBowl
  const beach = smoothstep(radius * 0.58, radius * 0.88, r)
  h = h * (1 - beach * 0.72) + 0.2 * beach
  h *= radial
  return Math.max(h, WATER_LEVEL - 0.05) * radial + (radial < 1 ? (radial - 1) * 2.5 : 0)
}

/** Continuous ground height at xz (main + sister island). */
export function groundHeight(x: number, z: number): number {
  const main = radialIslandHeight(x, z, ISLAND_RADIUS, 0, { northCove: true })
  const lx = x - SECOND_ISLAND.x
  const lz = z - SECOND_ISLAND.z
  const sister = radialIslandHeight(lx, lz, SECOND_ISLAND.radius, 17)
  return Math.max(main, sister)
}

export function distToSecondIsland(x: number, z: number) {
  return Math.hypot(x - SECOND_ISLAND.x, z - SECOND_ISLAND.z)
}

/** True when standing on / inside the sister island footprint. */
export function isOnSecondIsland(x: number, z: number) {
  return distToSecondIsland(x, z) < SECOND_ISLAND.radius * 0.98 && groundHeight(x, z) > WATER_LEVEL
}

/**
 * Exclusion radius around the sister island — without a raft, keep the player out
 * of this bubble (swim can use the lagoon but cannot cross to the new land).
 */
export const SECOND_ISLAND_RAFT_ONLY_RADIUS = SECOND_ISLAND.radius + 18

export function isOnIsland(x: number, z: number) {
  return groundHeight(x, z) > WATER_LEVEL - 0.02
}

export function surfaceAt(x: number, z: number) {
  const h = groundHeight(x, z)
  const wet = h <= WATER_LEVEL + 0.08
  return { y: Math.max(h, WATER_LEVEL), wet, landY: h }
}

export function biomeAt(x: number, z: number): 'sand' | 'grass' | 'rock' | 'jungle' {
  const d2 = distToSecondIsland(x, z)
  if (d2 < SECOND_ISLAND.radius * 1.02) {
    const h = groundHeight(x, z)
    if (d2 > SECOND_ISLAND.radius * 0.68 || h < WATER_LEVEL + 0.4) return 'sand'
    if (h > 3.8) return 'rock'
    if (d2 < SECOND_ISLAND.radius * 0.55) return 'jungle'
    return 'grass'
  }
  const r = Math.hypot(x, z)
  const h = groundHeight(x, z)
  if (r > ISLAND_RADIUS * 0.68 || h < WATER_LEVEL + 0.4) return 'sand'
  if (h > 4.5 || (Math.abs(x) > 40 && z > 30)) return 'rock'
  if (r < JUNGLE_RADIUS) return 'jungle'
  return 'grass'
}

/** Soft clearing corridors so dense jungle stays walkable. */
export function isClearing(x: number, z: number): boolean {
  const d2 = distToSecondIsland(x, z)
  if (d2 < SECOND_ISLAND.radius) {
    if (d2 > SECOND_ISLAND.radius * 0.55) return true
    return Math.abs(x - SECOND_ISLAND.x) < 3.5 || fbm(x * 0.05, z * 0.05) > 0.7
  }
  const r = Math.hypot(x, z)
  if (r > JUNGLE_RADIUS) return true
  const toCenter = Math.abs(x) < 4.5 && z < 10
  const toVendor = Math.abs(z + 40) < 3.5 && x > -40 && x < 5
  const toGate = Math.abs(x) < 5 && z > 10 && z < GATE_Z + 2
  const noiseGap = fbm(x * 0.04 + 3, z * 0.04 - 1) > 0.72
  return toCenter || toVendor || toGate || noiseGap
}
