import * as THREE from 'three'

/** Procedural monkey with sunglasses and sandals. */
export function createMonkey(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'monkey'

  const fur = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 })
  const furDark = new THREE.MeshStandardMaterial({ color: 0x5c3a1a, roughness: 0.9 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xc48a6a, roughness: 0.7 })
  const shades = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0.6,
    roughness: 0.25,
  })
  const lens = new THREE.MeshStandardMaterial({
    color: 0x1a2a33,
    metalness: 0.8,
    roughness: 0.15,
    transparent: true,
    opacity: 0.85,
  })
  const sandalL = new THREE.MeshStandardMaterial({ color: 0xe4572e, roughness: 0.7 })
  const sandalR = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.7 })
  const white = new THREE.MeshStandardMaterial({ color: 0xfff5e0, roughness: 0.55 })

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 6, 10), fur)
  torso.position.y = 0.95
  torso.castShadow = true // sole shadow caster in the scene budget
  root.add(torso)

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin)
  belly.scale.set(1, 1.1, 0.7)
  belly.position.set(0, 0.88, 0.14)
  root.add(belly)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 14), fur)
  head.position.y = 1.48
  head.castShadow = false
  root.add(head)

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), skin)
  face.scale.set(0.95, 1, 0.7)
  face.position.set(0, 1.42, 0.16)
  root.add(face)

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), skin)
  snout.scale.set(1.1, 0.8, 1.2)
  snout.position.set(0, 1.34, 0.28)
  root.add(snout)

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), furDark)
    ear.scale.set(0.7, 1, 0.4)
    ear.position.set(side * 0.26, 1.55, 0)
    root.add(ear)
  }

  // Sunglasses
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), shades)
  bridge.position.set(0, 1.48, 0.3)
  root.add(bridge)
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 16), shades)
    frame.position.set(side * 0.1, 1.48, 0.3)
    frame.rotation.y = Math.PI / 2
    root.add(frame)
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), lens)
    glass.position.set(side * 0.1, 1.48, 0.305)
    root.add(glass)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), shades)
    arm.position.set(side * 0.2, 1.48, 0.2)
    arm.rotation.y = side * 0.45
    root.add(arm)
  }

  // Arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 4, 8), fur)
    arm.position.set(side * 0.38, 1.05, 0)
    arm.rotation.z = side * 0.25
    arm.castShadow = false
    root.add(arm)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skin)
    hand.position.set(side * 0.42, 0.78, 0.05)
    root.add(hand)
  }

  // Legs + sandals
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.28, 4, 8), furDark)
    leg.position.set(side * 0.14, 0.48, 0)
    leg.castShadow = false
    root.add(leg)

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.24), side < 0 ? sandalL : sandalR)
    foot.position.set(side * 0.14, 0.12, 0.04)
    foot.castShadow = false
    root.add(foot)

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), white)
    strap.position.set(side * 0.14, 0.16, 0.02)
    root.add(strap)
  }

  // Tail
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.45, 4, 8), furDark)
  tail.position.set(0, 0.85, -0.32)
  tail.rotation.x = 0.9
  root.add(tail)

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      ;(o as THREE.Mesh).receiveShadow = true
    }
  })

  return root
}
