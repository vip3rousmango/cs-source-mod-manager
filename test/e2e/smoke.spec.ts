import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function electronExecutable(): string {
  if (process.platform === 'darwin') return join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  if (process.platform === 'win32') return join(process.cwd(), 'node_modules/electron/dist/electron.exe')
  return join(process.cwd(), 'node_modules/electron/dist/electron')
}

test('launches the built Electron main process and browses a populated curated catalog', async () => {
  const fixtureManifest = join(process.cwd(), 'test/fixtures/catalog/catalog/manifest.json')
  const userData = await mkdtemp(join(tmpdir(), 'csmm-e2e-'))
  const application = await electron.launch({
    executablePath: electronExecutable(),
    args: [`--user-data-dir=${userData}`, join(process.cwd(), '.vite/build/index.js')],
    env: { ...process.env, CSMM_TEST_CATALOG_PATH: fixtureManifest, CSMM_TEST_USER_DATA: userData }
  })
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: 'Game setup' })).toBeVisible()
    await page.getByRole('button', { name: 'catalog' }).click()
    await expect(page.getByRole('heading', { name: 'Mod catalog' })).toBeVisible()
    await expect(page.getByRole('button', { name: /CSMM Demo Content Pack/ })).toBeVisible()
    await expect(page.getByRole('complementary').getByRole('heading', { name: 'CSMM Demo Content Pack' })).toBeVisible()
    await expect(page.getByText('Download & install')).toBeVisible()
    await page.getByRole('textbox', { name: 'Search mods' }).fill('sounds')
    await expect(page.getByRole('button', { name: /CSMM Second Content Pack/ })).toBeVisible()
    await expect(page.getByRole('complementary').getByRole('heading', { name: 'CSMM Second Content Pack' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search mods' }).fill('does-not-exist')
    await expect(page.getByText('No mods match this search.')).toBeVisible()
    await page.getByRole('button', { name: 'discover' }).click()
    await expect(page.getByRole('heading', { name: 'Find your next loadout.' })).toBeVisible()
    await expect(page.getByText('Your library starts here.')).toBeVisible()
    await page.getByRole('button', { name: 'library' }).click()
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible()
    await page.getByRole('button', { name: 'server downloads' }).click()
    await expect(page.getByRole('heading', { name: 'Downloads from servers' })).toBeVisible()
    await expect(page.getByText('Connect a game installation first.')).toBeVisible()
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})

test('browses and opens a live GameBanana result through the Electron bridge', async () => {
  test.skip(process.env.CSMM_LIVE_PROVIDER_SMOKE !== '1', 'Set CSMM_LIVE_PROVIDER_SMOKE=1 to run the external-provider smoke test.')
  const userData = await mkdtemp(join(tmpdir(), 'csmm-provider-e2e-'))
  const application = await electron.launch({
    executablePath: electronExecutable(),
    args: [`--user-data-dir=${userData}`, join(process.cwd(), '.vite/build/index.js')],
    env: { ...process.env, CSMM_TEST_USER_DATA: userData }
  })
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'discover' }).click()
    await page.getByRole('textbox', { name: 'Search GameBanana mods' }).fill('hud')
    await page.getByRole('button', { name: 'Search' }).click()
    const firstResult = page.locator('.provider-card').first()
    await expect(firstResult).toBeVisible({ timeout: 30_000 })
    await firstResult.click()
    await expect(page.getByRole('complementary').getByRole('heading').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('complementary').getByText('Files', { exact: true })).toBeVisible()
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})
