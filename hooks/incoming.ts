import type { ChangedFile } from '../types'

/** `git rev-list HEAD..@{u}`: one full or abbreviated hash per line; anything else (an error message) is dropped. */
export function parseHashes(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[0-9a-f]{7,64}$/.test(line))
}

/**
 * `git log HEAD..@{u} --name-only --format=%x1e%H`: a record separator and the hash, a blank line, then the
 * commit's paths, one per line. A merge lists no paths. Run with `core.quotepath=off` so a non-ASCII name arrives as typed.
 */
export function parseNameOnly(stdout: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const chunk of stdout.split('\x1e')) {
    const [hash, ...paths] = chunk
      .split('\n')
      .map(line => line.replace(/\r$/, ''))
      .filter(line => line.length > 0)
    if (hash !== undefined) out[hash] = paths
  }
  return out
}

/** Every path the working tree has changed; a renamed file counts by both names. */
export function dirtyPaths(files: ChangedFile[]): string[] {
  return files.flatMap(file => (file.orig === undefined ? [file.path] : [file.path, file.orig]))
}

/** For each incoming commit, the files it changes that the working tree also has changed; commits that touch none are left out. */
export function findClashes(files: Record<string, string[]>, dirty: string[]): Record<string, string[]> {
  const mine = new Set(dirty)
  const out: Record<string, string[]> = {}
  for (const [hash, paths] of Object.entries(files)) {
    const hit = paths.filter(path => mine.has(path))
    if (hit.length > 0) out[hash] = hit
  }
  return out
}

/** `⚠ touches your pane.tsx`, with `+N` when more files clash. */
export function clashLabel(paths: string[]): string {
  const first = paths[0] ?? ''
  const name = first.slice(first.lastIndexOf('/') + 1)
  return `⚠ touches your ${name}${paths.length > 1 ? ` +${paths.length - 1}` : ''}`
}

/** The log of the files each incoming commit changes: renames off, so a renamed file lists its old path too and a rename of a file being edited clashes. */
export function incomingFilesCommand(): string[] {
  return ['git', '-c', 'core.quotepath=off', 'log', '--no-renames', 'HEAD..@{u}', '--name-only', '--format=%x1e%H']
}
