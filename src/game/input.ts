export class Input {
  readonly keys = new Set<string>()
  mouseDX = 0
  mouseDY = 0
  pointerLocked = false
  private wasPointerLocked = false
  /** Fires once when pointer lock is lost after having been locked. */
  onPointerUnlock: (() => void) | null = null

  /** Optional one-shot handlers (e.g. overdrive) — fired before Set updates. */
  onActionKey: ((code: string) => void) | null = null

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.keys.add(e.code)
    // Gameplay keys — prevent browser chrome from eating them under pointer lock
    if (
      ['Space', 'KeyE', 'KeyO', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)
    ) {
      e.preventDefault()
    }
    if (e.code === 'KeyO') this.onActionKey?.(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return
    this.mouseDX += e.movementX
    this.mouseDY += e.movementY
  }

  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement !== null
    if (this.wasPointerLocked && !this.pointerLocked) {
      // Keep WASD state — unlocking the mouse (Esc) must not cancel movement.
      this.mouseDX = 0
      this.mouseDY = 0
      this.onPointerUnlock?.()
    }
    this.wasPointerLocked = this.pointerLocked
  }

  private readonly onVisibility = () => {
    if (document.hidden) {
      this.clearKeys()
      this.mouseDX = 0
      this.mouseDY = 0
    }
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  clearKeys() {
    this.keys.clear()
  }

  consumeMouse() {
    const dx = this.mouseDX
    const dy = this.mouseDY
    this.mouseDX = 0
    this.mouseDY = 0
    return { dx, dy }
  }

  pressed(code: string) {
    return this.keys.has(code)
  }
}
