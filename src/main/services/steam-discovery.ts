import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize, dirname } from 'node:path'
import { AppError } from './errors'
import type { GameInstallation } from '../../shared/contracts'

interface SteamCandidate { steamRoot: string; installPath: string }

function parseVdfLibraries(input: string): string[] {
  const libraries: string[] = []
  const rootPattern = /"path"\s+"((?:\\.|[^"\\])*)"/g
  for (const match of input.matchAll(rootPattern)) {
    libraries.push(match[1].replaceAll('\\\\', '\\'))
  }
  return libraries
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function findInstall(libraryRoot: string): Promise<Candidate | undefined> {
  const manifestPath = join(libraryRoot, 'steamapps', 'appmanifest_240.acf')
  if (!await pathExists(manifestPath)) return undefined
  const manifest = await readFile(manifestPath, 'utf8').catch(() => '')
  const installDir = /"installdir"\s+"([^"]+)"/i.exec(manifest)?.[1]
  if (!installDir) return undefined
  const installPath = join(libraryRoot, 'steamapps', 'common', installDir)
  if (!await pathExists(join(installPath, 'cstrike'))) return undefined
  return { steamRoot: libraryRoot, installPath }
}

interface Candidate { steamRoot: string; installPath: string }

export class SteamDiscoveryService {
  async discover(): Promise<GameInstallation[]> {
    const roots = this.platformSteamRoots()
    const candidates: GameInstallation[] = []
    const libraries = new Set<string>()
    for (const steamRoot of roots) {
      libraries.add(steamRoot)
      const libraryFile = join(steamRoot, 'steamapps', 'libraryfolders.vdf')
      if (await pathExists(libraryFile)) {
        const content = await readFile(libraryFile, 'utf8').catch(() => '')
        for (const library of parseVdfLibraries(content)) libraries.add(normalize(library))
      }
    }
    for (const library of libraries) {
      const candidate = await findInstall(library)
      if (candidate) {
        candidates.push({ gameId: 'counter-strike-source', steamRoot: candidate.steamRoot, installPath: candidate.installPath, contentPath: join(candidate.installPath, 'cstrike'), detectedAt: new Date().toISOString() })
      }
    }
    return candidates
  }

  async validateDirectory(selectedPath: string): Promise<GameInstallation> {
    const normalized = normalize(selectedPath)
    const contentPath = normalized.endsWith(`${join('', 'cstrike')}`) ? normalized : join(normalized, 'cstrike')
    const installPath = contentPath === normalized ? dirname(normalized) : normalized
    if (!await pathExists(contentPath)) throw new AppError('INVALID_GAME_DIRECTORY', 'Select the Counter-Strike: Source installation directory or its cstrike folder.')
    return { gameId: 'counter-strike-source', steamRoot: installPath, installPath, contentPath, detectedAt: new Date().toISOString() }
  }

  private platformSteamRoots(): string[] {
    if (process.platform === 'win32') {
      const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
      return [join(programFiles, 'Steam'), join(programFilesX86, 'Steam')]
    }
    const home = homedir()
    return [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam'), join(home, '.steam', 'root')]
  }
}
