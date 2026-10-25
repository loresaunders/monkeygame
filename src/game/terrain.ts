/** Island terrain helpers — units roughly meters. */

export const ISLAND_RADIUS = 42
export const WATER_LEVEL = 0.15
export const GATE_Z = 18

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

/** Continuous ground height at xz. Negative / near-zero is underwater shelf. */
export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const radial = 1 - smoothstep(ISLAND_RADIUS * 0.72, ISLAND_RADIUS, r)
  if (radial <= 0.001) return -1.8

  const n = fbm(x * 0.045, z * 0.045)
  const hills = fbm(x * 0.09 + 20, z * 0.09 - 8) * 2.4
  const ridge = Math.max(0, 1.6 - Math.hypot(x + 6, z - 4) * 0.18) * 3.2
  const northRise = smoothstep(8, 28, z) * 1.8
  const coveBowl = -smoothstep(20, 34, z) * Math.max(0, 1 - Math.abs(x) / 10) * 1.1

  let h = 0.35 + n * 1.8 + hills * 0.55 + ridge + northRise + coveBowl
  // Beach shelf near waterline
  const beach = smoothstep(ISLAND_RADIUS * 0.55, ISLAND_RADIUS * 0.85, r)
  h = h * (1 - beach * 0.65) + 0.22 * beach
  h *= radial
  return Math.max(h, WATER_LEVEL - 0.05) * radial + (radial < 1 ? (radial - 1) * 2.5 : 0)
}

export function isOnIsland(x: number, z: number) {
  return groundHeight(x, z) > WATER_LEVEL - 0.02 && Math.hypot(x, z) < ISLAND_RADIUS + 0.5
}

export function surfaceAt(x: number, z: number) {
  const h = groundHeight(x, z)
  const wet = h <= WATER_LEVEL + 0.08
  return { y: Math.max(h, WATER_LEVEL), wet, landY: h }
}

export function biomeAt(x: number, z: number): 'sand' | 'grass' | 'rock' {
  const r = Math.hypot(x, z)
  const h = groundHeight(x, z)
  if (r > ISLAND_RADIUS * 0.62 || h < WATER_LEVEL + 0.45) return 'sand'
  if (h > 3.2 || (Math.abs(x) > 14 && z > 10)) return 'rock'
  return 'grass'
}
