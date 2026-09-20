import { downloadArtifact } from '@electron/get'
import { accessSync, constants, createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs'
import { chmod, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

const require = createRequire(import.meta.url)
const electronPackage = dirname(require.resolve('electron/package.json'))
const electronMetadata = JSON.parse(readFileSync(join(electronPackage, 'package.json'), 'utf8'))
const metadataRelativePath = process.platform === 'darwin'
  ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? 'electron.exe'
    : 'electron'
const executablePath = join(electronPackage, 'dist', metadataRelativePath)
const metadataPath = join(electronPackage, 'path.txt')
const distPath = join(electronPackage, 'dist')

function isUsable() {
  if (!existsSync(executablePath) || !existsSync(metadataPath)) return false
  try {
    accessSync(executablePath, constants.X_OK)
    return readFileSync(metadataPath, 'utf8').trim() === metadataRelativePath.replaceAll('\\', '/')
  } catch {
    return false
  }
}
function entryMode(entry) {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

function isSymlink(entry) {
  return (entryMode(entry) & 0o170000) === 0o120000
}

function isDirectory(entry) {
  return entry.fileName.endsWith('/') || (entryMode(entry) & 0o170000) === 0o040000
}

async function extractArchive(archivePath, destination) {
  await new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return rejectPromise(openError ?? new Error('Unable to open Electron archive.'))
      const root = resolve(destination)
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        zip.close()
        rejectPromise(error)
      }
      const next = () => zip.readEntry()
      zip.on('error', fail)
      zip.on('end', () => {
        if (!settled) {
          settled = true
          resolvePromise()
        }
      })
      zip.on('entry', (entry) => {
        const target = resolve(destination, entry.fileName)
        if (target !== root && !target.startsWith(`${root}/`) && !target.startsWith(`${root}\\`)) {
          fail(new Error(`Electron archive contains an unsafe path: ${entry.fileName}`))
          return
        }
        const mode = entryMode(entry) & 0o777
        const targetDirectory = dirname(target)
        if (isDirectory(entry)) {
          mkdir(target, { recursive: true }).then(() => mode ? chmod(target, mode) : undefined).then(next).catch(fail)
          return
        }
        mkdir(targetDirectory, { recursive: true }).then(() => new Promise((resolveStream, rejectStream) => {
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return rejectStream(streamError ?? new Error('Unable to read Electron archive entry.'))
            if (isSymlink(entry)) {
              const chunks = []
              stream.on('data', (chunk) => chunks.push(chunk))
              stream.on('error', rejectStream)
              stream.on('end', () => resolveStream(Buffer.concat(chunks).toString('utf8')))
              return
            }
            pipeline(stream, createWriteStream(target)).then(() => resolveStream(undefined)).catch(rejectStream)
          })
        })).then(async (symlinkTarget) => {
          if (isSymlink(entry)) {
            const linkTarget = String(symlinkTarget)
            const resolvedLink = resolve(targetDirectory, linkTarget)
            if (resolvedLink !== root && !resolvedLink.startsWith(`${root}/`) && !resolvedLink.startsWith(`${root}\\`)) throw new Error(`Electron archive contains an unsafe symlink: ${entry.fileName}`)
            await rm(target, { force: true })
            await symlink(linkTarget, target)
          } else if (mode) {
            await chmod(target, mode)
          }
          next()
        }).catch(fail)
      })
      next()
    })
  })
}

if (!isUsable()) {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    throw new Error('ELECTRON_SKIP_BINARY_DOWNLOAD is set, but npm start needs the Electron development binary. Unset it and retry.')
  }
  console.log(`Electron ${electronMetadata.version} runtime is incomplete; downloading the development binary...`)
  const archivePath = await downloadArtifact({
    version: electronMetadata.version,
    artifactName: 'electron',
    cacheRoot: process.env.electron_config_cache,
    platform: process.platform,
    arch: process.arch
  })
  rmSync(distPath, { recursive: true, force: true })
  await extractArchive(archivePath, distPath)
  await writeFile(metadataPath, metadataRelativePath.replaceAll('\\', '/'))
}

if (!isUsable()) {
  throw new Error(`Electron runtime is still incomplete at ${electronPackage}. Remove node_modules/electron and run npm ci again.`)
}
