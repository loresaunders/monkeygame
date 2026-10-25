export class Input {
  readonly keys = new Set<string>()
  mouseDX = 0
  mouseDY = 0
  pointerLocked = false

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code)
    if (['Space', 'KeyE'].includes(e.code)) e.preventDefault()
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
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
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
