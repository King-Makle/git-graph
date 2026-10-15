import type { ActionKind, ChangedFile, Pending, Sync, SyncKind, Undo } from '../types'

/** The kinds whose confirm line carries the name Input. */
export const NAMED_KINDS: readonly ActionKind[] = ['branch', 'tag', 'rename-branch']

const BAD_NAME = /[\s~^:?*[\\]|\.\.|@\{|^-|\/$|\.lock$|^\.|\/\./

/**
 * A typed branch or tag name as git will take it: trimmed, with each run of spaces turned into one hyphen, since git
 * refuses spaces (`Tag Test` is `Tag-Test`, as GitHub Desktop does). The confirm line shows the result as you type.
 */
export const refName = (input: string): string => input.trim().replace(/\s+/g, '-')

function checkName(name: string, what: 'branch' | 'tag'): string | null {
  if (name.length === 0) return `Type a ${what} name first.`
  if (BAD_NAME.test(name)) return `${what === 'branch' ? 'Branch' : 'Tag'} names cannot contain "..", "~", "^", ":", "?", "*", "[" or a backslash, or start with "-" or ".".`
  return null
}

/** The git argv an action runs once confirmed, or why it cannot run yet. A merge is reverted against its first parent: what the merge brought in. */
export function actionCommand(pending: Pending, input: string, isMerge = false): { argv: string[] } | { error: string } {
  const { kind, hash } = pending
  const name = refName(input)
  const target = pending.target ?? ''
  switch (kind) {
    case 'checkout':
      return { argv: ['git', 'checkout', hash] }
    case 'cherry-pick':
      return { argv: ['git', 'cherry-pick', hash] }
    case 'reset':
      return { argv: ['git', 'reset', '--soft', hash] }
    case 'revert':
      return { argv: isMerge ? ['git', 'revert', '--no-edit', '-m', '1', hash] : ['git', 'revert', '--no-edit', hash] }
    case 'merge':
      return { argv: ['git', 'merge', '--no-edit', hash] }
    case 'rebase':
      return { argv: ['git', 'rebase', hash] }
    case 'delete-branch':
      return { argv: ['git', 'branch', pending.force === true ? '-D' : '-d', target] }
    case 'branch': {
      const error = checkName(name, 'branch')
      return error === null ? { argv: ['git', 'checkout', '-b', name, hash] } : { error }
    }
    case 'tag': {
      const error = checkName(name, 'tag')
      return error === null ? { argv: ['git', 'tag', name, hash] } : { error }
    }
    case 'rename-branch': {
      const error = checkName(name, 'branch')
      return error === null ? { argv: ['git', 'branch', '-m', target, name] } : { error }
    }
  }
}

/** The command that backs out of an action stopped by a conflict; null for the ones that cannot stop midway. */
export function abortCommand(kind: ActionKind): string[] | null {
  return kind === 'cherry-pick' || kind === 'revert' || kind === 'merge' || kind === 'rebase' ? ['git', kind, '--abort'] : null
}

/**
 * The confirm line: what the action does, in the words git would use for the result. A typed name shows as git will
 * take it, its spaces already hyphens, so the line is the preview.
 */
export function describeAction(pending: Pending, input: string, head: string): string {
  const name = refName(input) || '…'
  const short = pending.hash.slice(0, 7)
  const branch = head.length > 0 ? head : 'HEAD'
  const target = pending.target ?? ''
  switch (pending.kind) {
    case 'checkout':
      return `Check out ${short} as a detached HEAD?`
    case 'branch':
      return `Create branch ${name} at ${short} and switch to it?`
    case 'cherry-pick':
      return `Cherry-pick ${short} onto ${branch}?`
    case 'reset':
      return `Move ${branch} to ${short}, keeping the changes since as staged?`
    case 'revert':
      return `Revert ${short} with a new commit on ${branch}?`
    case 'merge':
      return `Merge ${short} into ${branch}?`
    case 'rebase':
      return `Rebase ${branch} onto ${short}?`
    case 'tag':
      return `Tag ${short} as ${name}?`
    case 'delete-branch':
      if (pending.force === true) return `Delete branch ${target}? It is not merged: its commits will only be in the reflog, which git clears after a while.`
      return pending.site === 'branches' ? `Delete branch ${target}? It is merged into ${branch}: nothing is lost.` : `Delete branch ${target}? Git refuses if it is not merged.`
    case 'rename-branch':
      return `Rename ${target} to ${name}?`
  }
}

/** Discard in one go: a staged new file must leave the index and the disk, or it would survive as untracked. */
export function discardCommands(file: ChangedFile): string[][] {
  if (file.status === 'U') return [['git', 'clean', '-f', '--', file.path]]
  if (file.status === 'A') return [['git', 'restore', '--staged', '--', file.path], ['git', 'clean', '-f', '--', file.path]]
  // A rename restores the old name too, or it would stay deleted.
  const names = file.orig === undefined ? [file.path] : [file.path, file.orig]
  return [['git', 'restore', '--staged', '--worktree', '--', ...names]]
}

/** Against HEAD, so a file staged in part shows all of it; an untracked file against nothing. */
export function diffCommand(file: ChangedFile): string[] {
  if (file.status === 'U') return ['git', 'diff', '--no-index', '--', '/dev/null', file.path]
  return ['git', 'diff', 'HEAD', '--', file.path]
}

export function syncCommand(kind: SyncKind, sync: Sync, head: string): string[] {
  if (kind === 'fetch') return ['git', 'fetch', '--prune']
  if (kind === 'pull') return ['git', 'pull', '--ff-only']
  return sync.upstream === null ? ['git', 'push', '-u', 'origin', head] : ['git', 'push']
}

export type UndoKind = ActionKind | 'commit' | 'stash' | 'pull' | 'switch'
/** What the action saw before it ran: HEAD's hash, the branch (empty when detached), the name typed, the branch acted on, and the commit acted on (a deleted branch's tip). */
export type UndoContext = { headHash: string; branch: string; name: string; target: string; hash?: string }

/**
 * The command that puts the last action back. `--keep` refuses, rather than
 * discards, when uncommitted work would be overwritten; `--soft` keeps a
 * commit's changes staged.
 */
export function inverseOf(kind: UndoKind, ctx: UndoContext): { label: string; argv: string[][] } | null {
  const back = ctx.branch.length > 0 ? ctx.branch : ctx.headHash
  switch (kind) {
    case 'commit':
      return { label: 'commit', argv: [['git', 'reset', '--soft', 'HEAD~1']] }
    case 'reset':
      return { label: 'reset', argv: [['git', 'reset', '--soft', ctx.headHash]] }
    case 'checkout':
      return { label: 'checkout', argv: [['git', 'checkout', back]] }
    case 'switch':
      return { label: 'switch', argv: [['git', 'checkout', back]] }
    case 'branch':
      return { label: 'branch', argv: [['git', 'checkout', back], ['git', 'branch', '-D', ctx.name]] }
    case 'cherry-pick':
      return { label: 'cherry-pick', argv: [['git', 'reset', '--keep', 'HEAD~1']] }
    case 'pull':
      return { label: 'pull', argv: [['git', 'reset', '--keep', ctx.headHash]] }
    case 'stash':
      return { label: 'stash', argv: [['git', 'stash', 'pop']] }
    case 'revert':
      return { label: 'revert', argv: [['git', 'reset', '--keep', 'HEAD~1']] }
    case 'merge':
    case 'rebase':
      return { label: kind, argv: [['git', 'reset', '--keep', ctx.headHash]] }
    case 'tag':
      return { label: 'tag', argv: [['git', 'tag', '-d', ctx.name]] }
    case 'rename-branch':
      return { label: 'rename', argv: [['git', 'branch', '-m', ctx.name, ctx.target]] }
    case 'delete-branch':
      // The branch comes back at the commit it pointed at.
      return ctx.hash === undefined ? null : { label: 'delete', argv: [['git', 'branch', ctx.target, ctx.hash]] }
  }
}

/** Valid while HEAD is where the action left it and, for a stash undo, while the pane's own stash is still on top. */
export function isUndoValid(record: Undo | null, headHash: string, stashHash = ''): boolean {
  if (record === null || record.expectHead !== headHash) return false
  return record.expectStash === undefined || record.expectStash === stashHash
}

/** A `$.process.run` that rejected (could not start, or hit its timeout) as a failed result, so every caller reads one shape. */
export function rejected(err: unknown): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
}
