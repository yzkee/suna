const path = require('path')

const { chromium } = require(require.resolve('playwright', {
  paths: [
    __dirname,
    path.resolve(__dirname, '../../apps/web'),
    path.resolve(__dirname, '../..'),
  ],
}))

const VIEWER_URL = process.env.AGENT_BROWSER_VIEWER_URL || 'http://localhost:14006/?session=kortix'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    await page.goto(VIEWER_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(5000)

    const result = await page.evaluate(() => {
      const canvas = document.getElementById('viewport')
      const wrap = document.getElementById('viewport-wrap')
      const status = document.getElementById('status')
      const frameInfo = document.getElementById('frame-info')
      const emptyState = document.getElementById('empty-state')

      if (!canvas || !wrap || !status || !frameInfo || !emptyState) {
        return { ok: false, reason: 'viewer DOM is missing required elements' }
      }

      const ctx = canvas.getContext('2d')
      let nonBlack = false
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        const sample = ctx.getImageData(
          Math.max(0, Math.floor(canvas.width / 2) - 1),
          Math.max(0, Math.floor(canvas.height / 2) - 1),
          2,
          2,
        ).data
        for (let i = 0; i < sample.length; i += 4) {
          if (sample[i] || sample[i + 1] || sample[i + 2]) {
            nonBlack = true
            break
          }
        }
      }

      const canvasBox = canvas.getBoundingClientRect()
      const wrapBox = wrap.getBoundingClientRect()
      const canvasVisible = getComputedStyle(canvas).display !== 'none'
      const emptyVisible = getComputedStyle(emptyState).display !== 'none'

      const ok = status.textContent === 'kortix'
        && status.className === 'connected'
        && frameInfo.textContent.trim().length > 0
        && canvasVisible
        && !emptyVisible
        && canvasBox.width > 0
        && canvasBox.height > 0
        && wrapBox.width > 0
        && wrapBox.height > 0
        && nonBlack

      return {
        ok,
        status: status.textContent,
        statusClass: status.className,
        frameInfo: frameInfo.textContent,
        canvasVisible,
        emptyVisible,
        canvasBox: { width: canvasBox.width, height: canvasBox.height },
        wrapBox: { width: wrapBox.width, height: wrapBox.height },
        canvasSize: { width: canvas.width, height: canvas.height },
        nonBlack,
      }
    })

    if (!result.ok) {
      await page.screenshot({ path: 'core/tests/browser-viewer-render-failure.png', fullPage: true })
      console.error(JSON.stringify(result, null, 2))
      process.exit(1)
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
