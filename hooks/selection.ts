import type { ChangedFile } from '../types'

/**
 * Ticks are the person's selection and nothing more: no git command runs when a box is ticked. Commit, Stage and Stash
 * act on the ticked files; the index is shown apart, as the Staged Changes group.
 */

/** Staged Changes (anything of the file is in the index) and Changes (anything differs from the index, new and conflicted files too). A file edited since it was staged is in both. */
export function groupFiles(files: ChangedFile[]): { staged: ChangedFile[]; changes: ChangedFile[] } {
  return { staged: files.filter(file => file.isStaged), changes: files.filter(file => file.isUnstaged) }
}

/** The ticked files that still have changes, in the order the list draws them. */
export function tickedFiles(files: ChangedFile[], ticked: string[]): ChangedFile[] {
  const set = new Set(ticked)
  return files.filter(file => set.has(file.path))
}

/** Paths for a git command: a renamed file by both names, or the old name's deletion would stay behind. */
export function pathsOf(files: ChangedFile[]): string[] {
  return files.flatMap(file => (file.orig === undefined ? [file.path] : [file.path, file.orig]))
}

export function toggleTick(ticked: string[], path: string): string[] {
  return ticked.includes(path) ? ticked.filter(entry => entry !== path) : [...ticked, path]
}

/** Every changed file's path: what ticking all selects, and what is ticked again once a commit has taken some. */
export function allPaths(files: ChangedFile[]): string[] {
  return files.map(file => file.path)
}

/** Every file ticked, unless every file already is, and then none. */
export function toggleAll(files: ChangedFile[], ticked: string[]): string[] {
  const all = allPaths(files)
  return all.length > 0 && all.every(path => ticked.includes(path)) ? [] : all
}

/** Ticks of files that are no longer changed are dropped. */
export function pruneTicked(ticked: string[], files: ChangedFile[]): string[] {
  const here = new Set(files.map(file => file.path))
  return ticked.filter(path => here.has(path))
}

/**
 * Commit what is ticked, as it is on disk now: add those paths, then commit exactly those paths, so files staged some
 * other way are left staged. Null when nothing ticked is changed.
 */
export function commitCommands(message: string, files: ChangedFile[], ticked: string[]): string[][] | null {
  const paths = pathsOf(tickedFiles(files, ticked))
  if (paths.length === 0) return null
  return [
    ['git', 'add', '--', ...paths],
    ['git', 'commit', '-m', message.trim(), '--', ...paths],
  ]
}

/** Stage what is ticked. */
export function stageCommand(files: ChangedFile[], ticked: string[]): string[] | null {
  const paths = pathsOf(tickedFiles(files, ticked))
  return paths.length === 0 ? null : ['git', 'add', '--', ...paths]
}

/** Take files out of the index; the working tree is untouched. */
export function unstageCommand(files: ChangedFile[]): string[] | null {
  const paths = pathsOf(files)
  return paths.length === 0 ? null : ['git', 'restore', '--staged', '--', ...paths]
}

/** The ticked files when some but not all are ticked; everything otherwise. `-u` takes untracked files too. */
export function stashCommand(message: string, files: ChangedFile[], ticked: string[]): string[] {
  const chosen = tickedFiles(files, ticked)
  const paths = chosen.length > 0 && chosen.length < files.length ? ['--', ...chosen.map(file => file.path)] : []
  const named = message.trim().length > 0 ? ['-m', message.trim()] : []
  return ['git', 'stash', 'push', '-u', ...named, ...paths]
}
