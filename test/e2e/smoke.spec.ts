import { _electron as electron, expect, test } from '@playwright/test'
import { join } from 'node:path'

function electronExecutable(): string {
  if (process.platform === 'darwin') return join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  if (process.platform === 'win32') return join(process.cwd(), 'node_modules/electron/dist/electron.exe')
  return join(process.cwd(), 'node_modules/electron/dist/electron')
}

test('launches the desktop shell and browses a populated curated catalog', async () => {
  const fixtureRoot = join(process.cwd(), 'test/fixtures/catalog')
  const application = await electron.launch({ cwd: fixtureRoot, executablePath: electronExecutable(), args: [join(process.cwd(), '.vite/build/index.js')] })
  try {
    const page = await application.firstWindow()
    await expect(page.locator('h1')).toHaveText('CS Source Mod Manager')
    await page.getByRole('button', { name: 'catalog' }).click()
    await expect(page.getByRole('heading', { name: 'Mod catalog' })).toBeVisible()
    await expect(page.getByRole('button', { name: /CSMM Demo Content Pack/ })).toBeVisible()
    await expect(page.getByRole('complementary').getByRole('heading', { name: 'CSMM Demo Content Pack' })).toBeVisible()
    await expect(page.getByText('Download & install')).toBeVisible()
    await page.getByRole('textbox', { name: 'Search mods' }).fill('materials')
    await expect(page.getByRole('button', { name: /CSMM Demo Content Pack/ })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search mods' }).fill('does-not-exist')
    await expect(page.getByText('No mods match this search.')).toBeVisible()
  } finally {
    await application.close()
  }
})
