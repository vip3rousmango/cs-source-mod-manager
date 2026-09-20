import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative } from 'node:path'
import type { AppState, DeploymentFile, DeploymentManifest, DeploymentPreview, InstalledMod, ModProfile, ProgressEvent } from '../../shared/contracts'
import { AppError } from './errors'

interface OwnedFile { absolutePath: string; modId: string; priority: number; relativePath: string }

async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }

async function listFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (entry.isDirectory()) output.push(...await listFiles(root, path))
    else if (entry.isFile()) output.push(path)
  }
  return output
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

export class DeploymentService {
  constructor(private readonly stateRoot: string, private readonly emit: (event: ProgressEvent) => void) {}

  async preview(state: AppState, profileId: string): Promise<DeploymentPreview> {
    const profile = this.profile(state, profileId)
    const mods = new Map(state.installedMods.map((mod) => [mod.id, mod]))
    const missingModIds = profile.entries.filter((entry) => !mods.has(entry.modId)).map((entry) => entry.modId)
    const disabledModIds = profile.entries.filter((entry) => !entry.enabled).map((entry) => entry.modId)
    const owners = new Map<string, OwnedFile[]>()
    let fileCount = 0
    for (const entry of profile.entries.filter((candidate) => candidate.enabled)) {
      const mod = mods.get(entry.modId)
      if (!mod || !await exists(mod.contentPath)) continue
      for (const absolutePath of await listFiles(mod.contentPath)) {
        const relativePath = relative(mod.contentPath, absolutePath).replaceAll('\\', '/')
        const key = relativePath.toLowerCase()
        const list = owners.get(key) ?? []
        list.push({ absolutePath, modId: mod.id, priority: entry.priority, relativePath })
        owners.set(key, list)
        fileCount += 1
      }
    }
    const conflicts = [...owners.values()].filter((files) => files.length > 1).map((files) => {
      const sorted = [...files].sort((a, b) => b.priority - a.priority || a.modId.localeCompare(b.modId))
      return { relativePath: sorted[0].relativePath, winnerModId: sorted[0].modId, loserModIds: sorted.slice(1).map((file) => file.modId) }
    })
    return { profileId, fileCount, conflicts, missingModIds, disabledModIds }
  }

  async deploy(state: AppState, profileId: string, confirmConflicts: boolean, operationId = profileId): Promise<{ state: AppState; manifest: DeploymentManifest }> {
    const preview = await this.preview(state, profileId)
    if (preview.missingModIds.length) throw new AppError('PROFILE_INVALID', 'Profile references missing mods.', preview.missingModIds)
    if (preview.conflicts.length && !confirmConflicts) throw new AppError('CONFLICT_CONFIRMATION_REQUIRED', 'Review and confirm the file conflicts before deploying.', preview.conflicts)
    if (!state.game) throw new AppError('GAME_NOT_FOUND', 'Configure Counter-Strike: Source before deploying a profile.')
    const profile = this.profile(state, profileId)
    const targetRoot = join(state.game.contentPath, 'custom', `CSMM_${profile.id}`)
    const previousRoot = state.activeDeployment?.targetPath
    const replacementRoot = previousRoot && previousRoot !== targetRoot ? previousRoot : targetRoot
    const tempRoot = join(state.game.contentPath, 'custom', `.CSMM-${profile.id}-${Date.now()}.tmp`)
    const backupRoot = join(this.stateRoot, 'backups', 'counter-strike-source', `${Date.now()}-${profile.id}`)
    const journalPath = join(this.stateRoot, 'deployment-journal.json')
    await mkdir(dirname(targetRoot), { recursive: true })
    await mkdir(tempRoot, { recursive: true })
    await mkdir(this.stateRoot, { recursive: true })
    await writeFile(journalPath, JSON.stringify({ targetRoot, replacementRoot, tempRoot, backupRoot, previous: state.activeDeployment ?? null }), 'utf8')
    try {
      const mods = new Map(state.installedMods.map((mod) => [mod.id, mod]))
      const winners = new Map<string, OwnedFile>()
      for (const entry of profile.entries.filter((candidate) => candidate.enabled)) {
        const mod = mods.get(entry.modId)
        if (!mod) continue
        for (const absolutePath of await listFiles(mod.contentPath)) {
          const relativePath = relative(mod.contentPath, absolutePath).replaceAll('\\', '/')
          const key = relativePath.toLowerCase()
          const current = winners.get(key)
          if (!current || entry.priority > current.priority || (entry.priority === current.priority && mod.id.localeCompare(current.modId) < 0)) winners.set(key, { absolutePath, modId: mod.id, priority: entry.priority, relativePath })
        }
      }
      const files: DeploymentFile[] = []
      let copied = 0
      for (const winner of winners.values()) {
        const destination = join(tempRoot, winner.relativePath)
        await mkdir(dirname(destination), { recursive: true })
        await cp(winner.absolutePath, destination)
        files.push({ relativePath: winner.relativePath, ownerModId: winner.modId, sha256: await sha256(destination) })
        copied += 1
        this.emit({ operationId, stage: 'deploying', message: `Copied ${copied} files`, bytesDone: copied, bytesTotal: winners.size })
      }
      if (await exists(replacementRoot)) {
        await mkdir(dirname(backupRoot), { recursive: true })
        await rename(replacementRoot, backupRoot)
      }
      await rename(tempRoot, targetRoot)
      const manifest: DeploymentManifest = { profileId, gameId: 'counter-strike-source', targetPath: targetRoot, deployedAt: new Date().toISOString(), files, conflicts: preview.conflicts }
      const nextState: AppState = { ...state, activeDeployment: manifest }
      await rm(journalPath, { force: true })
      return { state: nextState, manifest }
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true })
      if (await exists(backupRoot) && !await exists(replacementRoot)) await rename(backupRoot, replacementRoot)
      throw new AppError('DEPLOYMENT_INTERRUPTED', 'Deployment failed and the previous manager-owned deployment was restored.', error)
    }
  }
  async recover(): Promise<void> {
    const journalPath = join(this.stateRoot, 'deployment-journal.json')
    if (!await exists(journalPath)) return
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { targetRoot: string; replacementRoot: string; tempRoot: string; backupRoot: string }
    await rm(journal.tempRoot, { recursive: true, force: true })
    if (await exists(journal.backupRoot) && !await exists(journal.replacementRoot)) await rename(journal.backupRoot, journal.replacementRoot)
    await rm(journalPath, { force: true })
  }

  private profile(state: AppState, profileId: string): ModProfile {
    const profile = state.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', `Profile ${profileId} was not found.`)
    return profile
  }
}
