import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function electronExecutable(): string {
  if (process.platform === 'darwin') return join(process.cwd(), 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  if (process.platform === 'win32') return join(process.cwd(), 'node_modules/electron/dist/electron.exe')
  return join(process.cwd(), 'node_modules/electron/dist/electron')
}

async function closeApplication(application: ElectronApplication): Promise<void> {
  const child = application.process()
  try { await application.evaluate(({ app }) => app.exit(0)) } catch {}
  if (child.exitCode === null) {
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000))
    ])
  }
  if (child.exitCode === null) child.kill('SIGKILL')
}

test('opens the consolidated collection and utility surfaces', async () => {
  const fixtureManifest = join(process.cwd(), 'test/fixtures/catalog/catalog/manifest.json')
  const userData = await mkdtemp(join(tmpdir(), 'csmm-e2e-'))
  const application = await electron.launch({
    executablePath: electronExecutable(),
    args: [`--user-data-dir=${userData}`, join(process.cwd(), '.vite/build/index.js')],
    env: { ...process.env, CSMM_TEST_CATALOG_PATH: fixtureManifest, CSMM_TEST_USER_DATA: userData }
  })
  try {
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Game coverage & setup' })).toBeVisible()
    await page.getByRole('button', { name: 'collection' }).click()
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Curated releases' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add to library' }).first()).toBeVisible()
    await page.getByRole('button', { name: 'discover' }).click()
    await expect(page.getByRole('heading', { name: 'Find your next loadout.' })).toBeVisible()
    await expect(page.getByText('Your library starts here.')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Mod source' }).getByRole('option', { name: 'Bundled catalog' })).toHaveCount(1)
    await page.getByRole('combobox', { name: 'Mod source' }).selectOption('catalog')
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Curated releases' })).toBeVisible()
    await page.getByRole('button', { name: 'server downloads' }).click()
    await expect(page.getByRole('heading', { name: 'Downloads from servers' })).toBeVisible()
    await expect(page.getByText('Connect a game installation first.')).toBeVisible()
  } finally {
    await closeApplication(application)
    await rm(userData, { recursive: true, force: true })
  }
})
test('renders provider cards and falls back when a preview image fails', async () => {
  const fixture = join(process.cwd(), 'test/fixtures/provider/provider.json')
  const userData = await mkdtemp(join(tmpdir(), 'csmm-provider-fixture-e2e-'))
  const application = await electron.launch({
    executablePath: electronExecutable(),
    args: [`--user-data-dir=${userData}`, join(process.cwd(), '.vite/build/index.js')],
    env: { ...process.env, CSMM_TEST_PROVIDER_FIXTURE: fixture, CSMM_TEST_USER_DATA: userData }
  })
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'discover' }).click()
    await page.getByRole('textbox', { name: 'Search GameBanana mods' }).fill('fixture')
    await page.getByRole('button', { name: 'Search' }).click()
    const firstResult = page.locator('.provider-card').first()
    await expect(firstResult).toBeVisible()
    const preview = firstResult.locator('img.provider-preview')
    await expect(preview).toBeVisible()
    await preview.evaluate((image) => image.dispatchEvent(new Event('error')))
    await expect(firstResult.locator('.provider-art span')).toBeVisible()
    const providerGrid = page.locator('.provider-grid')
    await expect(providerGrid).toBeVisible()
    await expect(providerGrid).toHaveCSS('display', 'grid')
    await firstResult.click()
    const details = page.locator('.provider-details')
    await expect(details.getByRole('heading', { name: 'Files' })).toBeVisible()
    await details.getByRole('button', { name: 'Install' }).first().click()
    await expect(page.locator('.alert.error').first()).toContainText('Deterministic provider download failure.')
    await expect(page.getByRole('complementary', { name: 'Downloads manager' })).toContainText('Deterministic provider download failure.')
    const addToPackButtons = details.getByRole('button', { name: 'Add to pack' })
    await addToPackButtons.nth(0).click()
    await addToPackButtons.nth(1).click()
    await page.getByRole('button', { name: 'Save pack' }).click()
    await page.getByRole('button', { name: 'collection' }).click()
    await expect(page.getByRole('heading', { name: 'Mod packs' })).toBeVisible()
    await page.getByRole('button', { name: 'Install full pack' }).click()
    await expect(page.locator('.shell > .alert.error').first()).toContainText('Pack installed 0 item(s); 2 failed.')
  } finally {
    await closeApplication(application)
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
    const preview = firstResult.locator('img.provider-preview')
    await expect(preview).toBeVisible({ timeout: 30_000 })
    await preview.evaluate((image) => image.dispatchEvent(new Event('error')))
    await expect(firstResult.locator('.provider-art span')).toBeVisible()
    await firstResult.click()
    await expect(page.locator('.provider-details').getByRole('heading').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.provider-details').getByRole('heading', { name: 'Files' })).toBeVisible()
  } finally {
    await closeApplication(application)
    await rm(userData, { recursive: true, force: true })
  }
})
