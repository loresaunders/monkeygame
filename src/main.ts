import './style.css'
import { Game } from './game/Game'

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
if (!canvas) throw new Error('Missing #game-canvas')

const game = new Game(canvas)
game.start()

document.getElementById('start-btn')?.addEventListener('click', () => {
  game.beginPlay()
})

// HMR-friendly dispose
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose())
}
