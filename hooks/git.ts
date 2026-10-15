import type { BranchInfo, ChangedFile, Commit, FileStatus, Stash, Worktree } from '../types'
import { ago } from './chips'

/**
 * `git log --shortstat --format=%H%x1f%P%x1f%D%x1f%aN%x1f%ar%x1f%ad%x1f%s%x1e`:
 * records split on the record separator, each followed by its shortstat line
 * (none for a merge), which belongs to the record before it.
 */
export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = []
  for (const chunk of stdout.split('\x1e')) {
    const lines = chunk.replace(/^\n+/, '').split('\n')
    if (lines.length > 0 && /^\s*\d+ files? changed/.test(lines[0] ?? '')) {
      const last = commits[commits.length - 1]
      if (last !== undefined) last.stat = lines.shift()!.trim()
    }
    const record = lines.join('\n')
    if (record.length === 0) continue
    const [hash = '', parents = '', refs = '', author = '', date = '', when = '', subject = ''] = record.split('\x1f')
    commits.push({
      hash,
      parents: parents.split(' ').filter(Boolean),
      refs: refs.split(', ').filter(Boolean),
      author,
      date,
      when,
      subject,
      stat: '',
    })
  }
  return commits
}

export type Status = { oid: string; branch: string; upstream: string | null; ahead: number; behind: number; files: ChangedFile[] }

/**
 * `git status --porcelain=v2 -b -z`: NUL-terminated records, never quoted, so
 * a path with spaces, quotes or non-ASCII comes through as typed. The
 * `# branch.*` headers, then one record per path: `1 XY ... path` (changed),
 * `2 XY ... Rnn path` followed by the old path as its own record (renamed or
 * copied), `u XY ... path` (unmerged), `? path` (untracked). X is the index
 * half, Y the working tree half, `.` for unchanged.
 */
export function parseStatus(stdout: string): Status {
  const status: Status = { oid: '', branch: '', upstream: null, ahead: 0, behind: 0, files: [] }
  const records = stdout.split('\0')
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!
    if (line.startsWith('# branch.oid ')) status.oid = line.slice(13)
    else if (line.startsWith('# branch.head ')) status.branch = line.slice(14) === '(detached)' ? '' : line.slice(14)
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const counts = /\+(\d+) -(\d+)/.exec(line)
      if (counts) {
        status.ahead = Number(counts[1])
        status.behind = Number(counts[2])
      }
    } else if (line.startsWith('? ')) status.files.push({ path: line.slice(2), status: 'U', isStaged: false, isUnstaged: true })
    else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const fields = line.split(' ')
      const xy = fields[1] ?? '..'
      // The path is everything after the fixed fields, so a path with spaces survives.
      const fixed = line.startsWith('1 ') ? 8 : line.startsWith('2 ') ? 9 : 10
      const path = fields.slice(fixed).join(' ')
      const orig = line.startsWith('2 ') ? records[++i] : undefined
      if (line.startsWith('u ')) {
        status.files.push({ path, status: 'C', isStaged: false, isUnstaged: true })
        continue
      }
      const isStaged = xy[0] !== '.'
      const isUnstaged = xy[1] !== '.'
      const file: ChangedFile = { path, status: letter(isStaged ? xy[0]! : xy[1]!), isStaged, isUnstaged }
      if (orig !== undefined) file.orig = orig
      // Staged and edited since: the file is in both groups, each with its own letter.
      if (isStaged && isUnstaged) file.treeStatus = letter(xy[1]!)
      status.files.push(file)
    }
  }
  return status
}

function letter(code: string): FileStatus {
  if (code === 'A' || code === 'C') return 'A'
  if (code === 'D') return 'D'
  if (code === 'R') return 'R'
  return 'M'
}

/**
 * `git stash list --format=%gd%x1f%H%x1f%gs%x1e --shortstat`: the ref, the
 * hash and the message per record, the shortstat line (files changed) after each.
 */
export function parseStashList(stdout: string): Stash[] {
  const stashes: Stash[] = []
  for (const chunk of stdout.split('\x1e')) {
    const lines = chunk.replace(/^\n+/, '').split('\n')
    const stat = /^\s*(\d+) files? changed/.exec(lines[0] ?? '')
    if (stat) {
      const last = stashes[stashes.length - 1]
      if (last !== undefined) last.files = Number(stat[1])
      lines.shift()
    }
    const record = lines.join('\n').trim()
    if (record.length === 0) continue
    const [ref = '', hash = '', message = ''] = record.split('\x1f')
    const index = /\{(\d+)\}/.exec(ref)
    stashes.push({ index: index ? Number(index[1]) : stashes.length, hash, message, files: 0 })
  }
  return stashes
}

/** `git for-each-ref --format=%(refname:short) refs/heads`: one local branch per line. */
export function parseBranches(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/** The local branches with their tip, commit date and upstream, one record a line, fields split on the unit separator. */
export const BRANCH_LIST_COMMAND = ['git', 'for-each-ref', '--format=%(refname:short)%1f%(objectname)%1f%(committerdate:relative)%1f%(committerdate:unix)%1f%(upstream:short)%1f%(upstream:track)', 'refs/heads']
/** The local branches every commit of which HEAD has. */
export const MERGED_COMMAND = ['git', 'branch', '--merged', 'HEAD', '--format=%(refname:short)']

/** `BRANCH_LIST_COMMAND` and `MERGED_COMMAND` joined: the branch you are on first, then the newest. */
export function parseBranchList(stdout: string, merged: string, current: string): BranchInfo[] {
  const isMerged = new Set(merged.split('\n').map(line => line.trim()).filter(Boolean))
  const list: BranchInfo[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue
    const [name = '', hash = '', relative = '', unix = '0', upstream = '', track = ''] = line.split('\x1f')
    list.push({ name, hash, age: ago(relative), time: Number(unix) || 0, upstream, isGone: track === '[gone]', isMerged: isMerged.has(name) })
  }
  return list.sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : b.time - a.time))
}

/** Every checkout of the repo, one record per worktree, fields and records split on NUL. */
export const WORKTREE_LIST_COMMAND = ['git', 'worktree', 'list', '--porcelain', '-z']
/** The folder this session runs in, to tell which worktree is this pane's. */
export const TOPLEVEL_COMMAND = ['git', 'rev-parse', '--show-toplevel']

/**
 * `WORKTREE_LIST_COMMAND`: each record is `worktree <path>`, `HEAD <hash>`, then `branch refs/heads/<name>` or
 * `detached` (or `bare`), and `locked`/`prunable` with an optional reason, each NUL-ended, with an empty field after
 * the record. `here` is this session's top-level folder. The main checkout is first, as git lists it.
 */
export function parseWorktrees(stdout: string, here: string): Worktree[] {
  const list: Worktree[] = []
  let current: Worktree | null = null
  for (const field of stdout.split('\0')) {
    if (field.length === 0) {
      current = null
      continue
    }
    const space = field.indexOf(' ')
    const key = space === -1 ? field : field.slice(0, space)
    const value = space === -1 ? '' : field.slice(space + 1)
    if (key === 'worktree') {
      const path = value.replace(/\/+$/, '')
      current = { path, folder: path.slice(path.lastIndexOf('/') + 1), branch: null, head: '', isMain: list.length === 0, isHere: path === here.trim().replace(/\/+$/, ''), isSession: path.includes('/.claude/worktrees/'), isGone: false }
      list.push(current)
    } else if (current === null) continue
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'prunable') current.isGone = true
  }
  return list
}

/** The worktree other than this pane's own that has `branch` checked out, or null. */
export function heldBy(worktrees: Worktree[], branch: string): Worktree | null {
  return worktrees.find(tree => tree.branch === branch && !tree.isHere) ?? null
}
