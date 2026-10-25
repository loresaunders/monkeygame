import { chromium } from 'playwright'

const url = process.env.GAME_URL || 'http://127.0.0.1:43217/'
const out = process.env.OUT || '/opt/cursor/artifacts/screenshots/04-shop-ui.png'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.click('#start-btn')
await page.waitForTimeout(800)
await page.evaluate(() => {
  const g = window.__monkeyGame
  g.debugAddBananas(25)
  g.debugOpenShop()
})
await page.waitForSelector('#shop-overlay:not(.hidden)')
await page.waitForTimeout(400)
await page.screenshot({ path: out, fullPage: true })
const text = await page.locator('#shop-panel').innerText()
console.log('SHOP_OK', text.includes('Build a Raft'), text.includes('Swimming'), text.includes('North Cove'))
await browser.close()
