import { _electron as electron, expect, test } from '@playwright/test'
import { join } from 'node:path'

function electronExecutable(): string {
  if (process.platform === 'darwin') return join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  if (process.platform === 'win32') return join(process.cwd(), 'node_modules/electron/dist/electron.exe')
  return join(process.cwd(), 'node_modules/electron/dist/electron')
}

test('launches the desktop shell and renders setup', async () => {
  const application = await electron.launch({ executablePath: electronExecutable(), args: [join(process.cwd(), '.vite/build/index.js')] })
  try {
    const page = await application.firstWindow()
    await expect(page.locator('h1')).toHaveText('CS Source Mod Manager')
    await expect(page.getByText('No Counter-Strike: Source installation selected.')).toBeVisible()
  } finally {
    await application.close()
  }
})
