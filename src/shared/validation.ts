import { z } from 'zod'
import type { CatalogManifest, ModProfile } from './contracts'

export const CatalogManifestSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1),
  entries: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    title: z.string().min(1),
    version: z.string().min(1),
    author: z.string().optional(),
    description: z.string().min(1),
    tags: z.array(z.string()),
    archiveUrl: z.string().url().refine((value) => value.startsWith('https://'), 'archiveUrl must use HTTPS'),
    archiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
    archiveSizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
    sourcePageUrl: z.string().url().optional(),
    contentRoot: z.enum(['auto', 'archive-root', 'single-directory'])
  }))
})

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  gameId: z.literal('counter-strike-source'),
  entries: z.array(z.object({ modId: z.string().min(1), enabled: z.boolean(), priority: z.number().int() })),
  updatedAt: z.string().datetime()
})

export function parseCatalog(value: unknown): CatalogManifest {
  return CatalogManifestSchema.parse(value)
}

export function parseProfile(value: unknown): ModProfile {
  return ProfileSchema.parse(value)
}

export function assertSafeRelativePath(value: string): string {
  if (!value || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error('Unsafe archive path')
  }
  const normalized = value.replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '')) {
    throw new Error('Unsafe archive path')
  }
  return parts.join('/')
}
