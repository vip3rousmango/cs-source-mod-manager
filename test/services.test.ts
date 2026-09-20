import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertSafeRelativePath, parseCatalog } from '../src/shared/validation'
import { importFolder } from '../src/main/services/archive-import'
import { DeploymentService } from '../src/main/services/deployment'
import type { AppState, GameInstallation, InstalledMod, ModProfile } from '../src/shared/contracts'

async function makeMod(root: string, name: string, value: string): Promise<InstalledMod> {
  const source = join(root, `${name}-source`)
  await mkdir(join(source, 'materials'), { recursive: true })
  await writeFile(join(source, 'materials', 'test.vmt'), value)
  return importFolder(source, { libraryRoot: join(root, 'library'), title: name, version: '1' })
}

describe('archive and catalog boundaries', () => {
  it('rejects traversal and absolute archive paths', () => {
    expect(() => assertSafeRelativePath('../escape.txt')).toThrow()
    expect(() => assertSafeRelativePath('/absolute.txt')).toThrow()
    expect(() => assertSafeRelativePath('C:/absolute.txt')).toThrow()
  })

  it('accepts a valid empty catalog and rejects non-HTTPS archives', () => {
    expect(parseCatalog({ schemaVersion: 1, catalogVersion: '1', entries: [] }).entries).toEqual([])
    expect(() => parseCatalog({ schemaVersion: 1, catalogVersion: '1', entries: [{ id: 'demo', title: 'Demo', version: '1', description: 'Demo', tags: [], archiveUrl: 'http://example.test/mod.zip', archiveSha256: 'a'.repeat(64), archiveSizeBytes: 10, contentRoot: 'auto' }] })).toThrow()
  })
})

describe('profile deployment', () => {
  it('resolves priority conflicts only after confirmation and preserves unmanaged files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'csmm-test-'))
    try {
      const gameContent = join(root, 'game', 'cstrike')
      await mkdir(join(gameContent, 'custom', 'unmanaged'), { recursive: true })
      await writeFile(join(gameContent, 'custom', 'unmanaged', 'keep.txt'), 'keep')
      const low = await makeMod(root, 'low-priority', 'low')
      const high = await makeMod(root, 'high-priority', 'high')
      const installation: GameInstallation = { gameId: 'counter-strike-source', steamRoot: root, installPath: join(root, 'game'), contentPath: gameContent, detectedAt: new Date().toISOString() }
      const profile: ModProfile = { id: 'profile-main', name: 'Main', gameId: 'counter-strike-source', entries: [{ modId: low.id, enabled: true, priority: 1 }, { modId: high.id, enabled: true, priority: 2 }], updatedAt: new Date().toISOString() }
      const state: AppState = { schemaVersion: 1, settings: {}, game: installation, installedMods: [low, high], profiles: [profile], activity: [] }
      const deployment = new DeploymentService(join(root, 'state'), () => undefined)
      const preview = await deployment.preview(state, profile.id)
      expect(preview.conflicts).toHaveLength(1)
      await expect(deployment.deploy(state, profile.id, false)).rejects.toMatchObject({ code: 'CONFLICT_CONFIRMATION_REQUIRED' })
      const deployed = await deployment.deploy(state, profile.id, true)
      expect(await readFile(join(deployed.manifest.targetPath, 'materials', 'test.vmt'), 'utf8')).toBe('high')
      expect(await readFile(join(gameContent, 'custom', 'unmanaged', 'keep.txt'), 'utf8')).toBe('keep')
      const empty: ModProfile = { id: 'profile-empty', name: 'Empty', gameId: 'counter-strike-source', entries: [], updatedAt: new Date().toISOString() }
      const switched = await deployment.deploy({ ...deployed.state, profiles: [profile, empty] }, empty.id, true)
      expect(switched.manifest.files).toHaveLength(0)
      expect(await readFile(join(gameContent, 'custom', 'unmanaged', 'keep.txt'), 'utf8')).toBe('keep')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
