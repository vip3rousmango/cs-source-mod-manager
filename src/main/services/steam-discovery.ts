import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { AppError } from './errors'
import { SOURCE_GAMES, type DetectedSourceInstallation, type GameInstallation, type SourceGameId } from '../../shared/contracts'


function parseVdfLibraries(input: string): string[] {
  const libraries: string[] = []
  const rootPattern = /"path"\s+"((?:\\.|[^"\\])*)"/g
  for (const match of input.matchAll(rootPattern)) libraries.push(match[1].replaceAll('\\\\', '\\'))
  return libraries
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function identifyGame(appId: number, manifest: string): SourceGameId | undefined {
  const installDir = /"installdir"\s+"([^"]+)"/i.exec(manifest)?.[1]?.toLowerCase() ?? ''
  const name = /"name"\s+"([^"]+)"/i.exec(manifest)?.[1]?.toLowerCase() ?? ''
  const direct = SOURCE_GAMES.find((game) => game.steamAppId === appId)
  if (direct) return direct.id
  return SOURCE_GAMES.find((game) => installDir.includes(game.contentDirectory) || name.includes(game.label.toLowerCase()))?.id
}

async function findInstalls(libraryRoot: string): Promise<DetectedSourceInstallation[]> {
  const steamApps = join(libraryRoot, 'steamapps')
  const files = await readdir(steamApps, { withFileTypes: true }).catch(() => [])
  const installations: DetectedSourceInstallation[] = []
  for (const file of files) {
    const match = /^appmanifest_(\d+)\.acf$/i.exec(file.name)
    if (!match || !file.isFile()) continue
    const manifest = await readFile(join(steamApps, file.name), 'utf8').catch(() => '')
    const gameId = identifyGame(Number(match[1]), manifest)
    if (!gameId) continue
    const game = SOURCE_GAMES.find((candidate) => candidate.id === gameId)
    const installDir = /"installdir"\s+"([^"]+)"/i.exec(manifest)?.[1]
    if (!game || !installDir) continue
    const installPath = join(steamApps, 'common', installDir)
    const contentPath = join(installPath, game.contentDirectory)
    if (!await pathExists(contentPath)) continue
    installations.push({ gameId, steamRoot: libraryRoot, installPath, contentPath, detectedAt: new Date().toISOString() })
  }
  return installations
}

export class SteamDiscoveryService {
  constructor(private readonly configuredRoots?: string[]) {}

  async discover(): Promise<DetectedSourceInstallation[]> {
    const roots = this.platformSteamRoots()
    const libraries = new Set<string>()
    for (const steamRoot of roots) {
      libraries.add(steamRoot)
      const libraryFile = join(steamRoot, 'steamapps', 'libraryfolders.vdf')
      if (await pathExists(libraryFile)) {
        const content = await readFile(libraryFile, 'utf8').catch(() => '')
        for (const library of parseVdfLibraries(content)) libraries.add(normalize(library))
      }
    }
    const candidates = (await Promise.all([...libraries].map((library) => findInstalls(library)))).flat()
    return [...new Map(candidates.map((candidate) => [`${candidate.gameId}:${candidate.installPath.toLowerCase()}`, candidate])).values()]
  }
  async validateDirectory(selectedPath: string): Promise<GameInstallation> {
    const normalized = normalize(selectedPath)
    const contentPath = normalized.toLowerCase().endsWith(`${join('', 'cstrike')}`) ? normalized : join(normalized, 'cstrike')
    const installPath = contentPath === normalized ? dirname(normalized) : normalized
    if (!await pathExists(contentPath)) throw new AppError('INVALID_GAME_DIRECTORY', 'Select the Counter-Strike: Source installation directory or its cstrike folder.')
    return { gameId: 'counter-strike-source', steamRoot: installPath, installPath, contentPath, detectedAt: new Date().toISOString() }
  }
  private platformSteamRoots(): string[] {
    if (this.configuredRoots) return this.configuredRoots
    if (process.platform === 'win32') {
      const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
      return [join(programFiles, 'Steam'), join(programFilesX86, 'Steam')]
    }
    const home = homedir()
    return [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam'), join(home, '.steam', 'root'), join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'), join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')]
  }
}
