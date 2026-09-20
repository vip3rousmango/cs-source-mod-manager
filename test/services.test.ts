import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState, GameInstallation, InstalledMod, ModProfile } from '../src/shared/contracts'
import { assertSafeRelativePath, parseCatalog } from '../src/shared/validation'
import { importArchive, importFolder } from '../src/main/services/archive-import'
import { DeploymentService } from '../src/main/services/deployment'
import { GameBananaProvider } from '../src/main/providers/gamebanana'

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
  it('keeps catalog entry IDs stable when titles differ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'csmm-catalog-'))
    try {
      await mkdir(join(root, 'library'), { recursive: true })
      const archivePath = join(process.cwd(), 'test/fixtures/catalog/demo-content-pack.zip')
      const installed = await importArchive(archivePath, {
        libraryRoot: join(root, 'library'),
        source: 'catalog',
        modId: 'verified-catalog-entry',
        title: 'A Different Display Title',
        version: '1',
        expectedSize: 884,
        expectedSha256: 'fae280d9cc24aa495ec535f0276d96cf670c9fd39c940dcbcbf563adcb715cd7',
        contentRoot: 'archive-root'
      })
      expect(installed.id).toBe('verified-catalog-entry')
      expect(installed.contentPath).toBe(join(root, 'library', 'mods', 'verified-catalog-entry', '1', 'content'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})


describe('GameBanana provider', () => {
  it('filters to Counter-Strike: Source and normalizes browse metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      _aMetadata: { _nRecordCount: 2 },
      _aRecords: [
        { _idRow: 11, _sName: 'CSS HUD', _sProfileUrl: 'https://gamebanana.com/mods/11', _sDescription: '<p>Readable &amp; safe</p>', _aGame: { _idRow: 2 }, _bHasFiles: true, _aTags: [{ _sName: 'HUD' }] },
        { _idRow: 12, _sName: 'Other Game', _aGame: { _idRow: 1 } }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await new GameBananaProvider().browse({ query: 'hud', page: 1, perPage: 20 })
      expect(result.mods).toHaveLength(1)
      expect(result.mods[0]).toMatchObject({ remoteModId: '11', title: 'CSS HUD', description: 'Readable & safe', tags: ['HUD'] })
      expect(String(fetchMock.mock.calls[0][0])).toContain('_sSearchString=hud')
      expect(String(fetchMock.mock.calls[0][0])).toContain('_idGameRow=2')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects malformed browse responses instead of treating them as empty results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ _aRecords: [] }), { status: 200 })))
    try {
      await expect(new GameBananaProvider().browse({ query: '', page: 1, perPage: 20 })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns plain text details and marks unsafe files non-installable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      _idRow: 11,
      _sName: 'CSS HUD',
      _sProfileUrl: 'https://gamebanana.com/mods/11',
      _sDescription: 'Summary',
      _sText: '<p>Hello <strong>world</strong></p>',
      _sLicense: '<p>CC BY</p>',
      _aLicenseChecklist: [{ _sText: 'Download and install this Mod', _bValue: true }],
      _aGame: { _idRow: 2 },
      _aFiles: [
        { _idRow: 21, _sFile: 'hud.zip', _nFilesize: 12, _sVersion: '1.0', _sDownloadUrl: 'https://gamebanana.com/dl/21', _sAvResult: 'clean', _sAnalysisResult: 'ok' },
        { _idRow: 22, _sFile: 'hud.rar', _nFilesize: 12, _sDownloadUrl: 'https://gamebanana.com/dl/22', _sAvResult: 'clean', _sAnalysisResult: 'ok' }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const details = await new GameBananaProvider().getDetails('11')
      expect(details.body).toBe('Hello world')
      expect(details.license).toBe('CC BY')
      expect(details.files[0]).toMatchObject({ id: '21', installable: true, format: 'zip' })
      expect(details.files[1]).toMatchObject({ id: '22', installable: false, format: 'rar' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('does not install files when provider consent is explicitly false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      _idRow: 11,
      _sName: 'CSS HUD',
      _sProfileUrl: 'https://gamebanana.com/mods/11',
      _aLicenseChecklist: [{ _sText: 'Download and install this Mod', _bValue: false }],
      _aGame: { _idRow: 2 },
      _aFiles: [{ _idRow: 21, _sFile: 'hud.zip', _nFilesize: 12, _sAvResult: 'clean', _sAnalysisResult: 'ok' }]
    }), { status: 200 })))
    try {
      const details = await new GameBananaProvider().getDetails('11')
      expect(details.files[0].installable).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('resolves only clean provider ZIP downloads over HTTPS', async () => {
    const details = {
      _idRow: 11,
      _sName: 'CSS HUD',
      _sProfileUrl: 'https://gamebanana.com/mods/11',
      _aLicenseChecklist: { yes: ['Download and install this Mod'] },
      _aGame: { _idRow: 2 },
      _aFiles: [{ _idRow: 21, _sFile: 'hud.zip', _nFilesize: 12, _sAvResult: 'clean', _sAnalysisResult: 'ok', _sMd5Checksum: '0123456789abcdef0123456789abcdef', _sDownloadUrl: 'https://gamebanana.com/dl/21' }]
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(details), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(details), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(new GameBananaProvider().resolveDownload('11', '21')).resolves.toMatchObject({ url: 'https://gamebanana.com/dl/21', checksumMd5: '0123456789abcdef0123456789abcdef' })
    } finally {
      vi.unstubAllGlobals()
    }
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
