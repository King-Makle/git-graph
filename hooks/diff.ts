import type { CommitFile } from '../types'

// Whole files are kept up to this many characters of diff; each file is one Code element, which takes at most 10000.
export const DIFF_BUDGET = 24000

/**
 * `git show -z --numstat` and `git show -z --name-status` of one commit, joined by path: each file's added and deleted
 * lines (null for binary) and its status letter. A rename is `added\tdeleted\t` then the old and new path in numstat,
 * `R100` then both paths in name-status; it is listed under its new path.
 */
export function parseCommitFiles(numstat: string, nameStatus: string): CommitFile[] {
  const statusOf = new Map<string, string>()
  const names = nameStatus.split('\0')
  for (let i = 0; i < names.length; i++) {
    const code = names[i]!
    if (code.length === 0) continue
    const letter = code[0]!
    if (letter === 'R' || letter === 'C') {
      statusOf.set(names[i + 2] ?? '', letter)
      i += 2
    } else {
      statusOf.set(names[i + 1] ?? '', letter)
      i += 1
    }
  }
  const files: CommitFile[] = []
  const counts = numstat.split('\0')
  for (let i = 0; i < counts.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(counts[i]!)
    if (match === null) continue
    let path = match[3]!
    if (path.length === 0) {
      path = counts[i + 2] ?? ''
      i += 2
    }
    const count = (text: string) => (text === '-' ? null : Number(text))
    files.push({ path, status: statusOf.get(path) ?? 'M', added: count(match[1]!), deleted: count(match[2]!) })
  }
  return files
}

/**
 * Keeps whole files of a `git show` diff up to `budget` characters, never a
 * partial hunk: the Code element refuses hunks whose lines do not add up.
 */
export function trimDiff(diff: string, budget = DIFF_BUDGET): { diff: string; droppedFiles: number } {
  const blocks = diff.split(/^(?=diff --git )/m).filter(block => block.startsWith('diff --git '))
  let kept = ''
  let count = 0
  for (const block of blocks) {
    if (kept.length + block.length > budget) break
    kept += block
    count += 1
  }
  return { diff: kept, droppedFiles: blocks.length - count }
}

export type DiffFile = { path: string; hunks: string; note: string }

/** One `git show` diff into its files: the Code element takes hunks, not the `diff --git` header. */
export function splitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  for (const block of diff.split(/^(?=diff --git )/m)) {
    if (!block.startsWith('diff --git ')) continue
    const lines = block.split('\n')
    const path = lines[0]!.replace(/^diff --git a\/.* b\//, '')
    const start = lines.findIndex(line => line.startsWith('--- '))
    if (start === -1) {
      const note = lines.some(line => line.startsWith('Binary files')) ? 'binary file' : 'no text changes'
      files.push({ path, hunks: '', note })
      continue
    }
    // Only the final newline goes: a blank context line is a lone space, and trimming it would
    // leave the hunk a line short of what its `@@` header counts, which the desktop refuses outright.
    const hunks = lines
      .slice(start)
      .filter(line => !line.startsWith('\\ No newline'))
      .join('\n')
      .replace(/\t/g, '    ')
      .replace(/[^\S\n]/g, ' ')
      .replace(/\n$/, '')
    // The Code element takes at most 10000 characters.
    if (hunks.length > 10000) files.push({ path, hunks: '', note: 'too large to show here' })
    else if (!hunksAddUp(hunks)) files.push({ path, hunks: '', note: 'diff could not be read' })
    else files.push({ path, hunks, note: '' })
  }
  return files
}

/**
 * Whether every `@@ -a,b +c,d @@` hunk holds exactly the lines it counts (context and removed
 * for the old side, context and added for the new). A hunk that does not is cut, and the
 * desktop drops the whole drawing rather than draw it.
 */
export function hunksAddUp(hunks: string): boolean {
  const lines = hunks.split('\n')
  let i = 0
  while (i < lines.length) {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(lines[i]!)
    if (header === null) {
      i += 1
      continue
    }
    let old = header[1] === undefined ? 1 : Number(header[1])
    let fresh = header[2] === undefined ? 1 : Number(header[2])
    i += 1
    while (old > 0 || fresh > 0) {
      const line = lines[i]
      if (line === undefined) return false
      const mark = line[0]
      if (mark === '-') old -= 1
      else if (mark === '+') fresh -= 1
      else if (mark === ' ' || line.length === 0) {
        old -= 1
        fresh -= 1
      } else return false
      i += 1
    }
    if (old !== 0 || fresh !== 0) return false
  }
  return true
}
