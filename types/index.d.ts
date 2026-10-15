export type Commit = {
  hash: string
  parents: string[]
  refs: string[]
  author: string
  /** Relative, as `%ar` spells it: `2 days ago`. */
  date: string
  /** Absolute, as the log's `--date=format:` spells it: `October 2, 2026 at 9:25 PM`. */
  when: string
  subject: string
  /** `--shortstat`'s line, `14 files changed, 949 insertions(+)`; empty for a merge. */
  stat: string
}

/** One file a commit changed, from `--numstat` and `--name-status` (a merge against its first parent). */
export type CommitFile = {
  path: string
  /** git's letter: M, A, D, R (renamed), C (copied) or T (type changed). */
  status: string
  /** Lines added and deleted; null for a binary file. */
  added: number | null
  deleted: number | null
}

export type Detail = {
  hash: string
  body: string
  files: CommitFile[]
  diff: string
  /** Files left out of `diff` to keep it under the drawing budget. */
  droppedFiles: number
  /** Paths whose hunks are shown; the rest are a stat row only. */
  open: string[]
  /** The file list is drawn only when asked: a long list is a lot of pane. */
  showFiles: boolean
  /** A long message body is clipped to a few lines until asked; absent is clipped. */
  showBody?: boolean
}

/** One letter as the Changes section shows it: `U` untracked, `C` conflicted (unmerged); copied counts as added. */
export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'U' | 'C'

export type ChangedFile = {
  path: string
  status: FileStatus
  /** Anything of it is in the index: the dot is filled. */
  isStaged: boolean
  /** Anything of it differs from the index. */
  isUnstaged: boolean
  /** A rename's old path: a discard or unstage must name both. */
  orig?: string
  /** The working tree's own letter, set only when the file is staged and edited since (it is then in both groups): `status` is the staged half's. */
  treeStatus?: FileStatus
}

/** A changed file whose diff is open under its row: `diff` is the hunks text the Code element takes, or empty. */
export type OpenFile = { path: string; diff: string }

export type SyncKind = 'fetch' | 'pull' | 'push'

export type Sync = {
  ahead: number
  behind: number
  /** `origin/main`, or null when the branch has no upstream. */
  upstream: string | null
  /** The sync command running now; the other two wait. */
  busy: SyncKind | null
  /** The header note: a sync or stash result, until the next action. */
  note: string | null
}

/** One `git stash list` entry: `index` is the n in `stash@{n}`. */
export type Stash = { index: number; hash: string; message: string; files: number }

/** The last pane action's inverse, valid while HEAD is where the action left it. */
export type Undo = { label: string; argv: string[][]; expectHead: string; expectStash?: string }

export type ActionKind = 'checkout' | 'branch' | 'cherry-pick' | 'reset' | 'revert' | 'merge' | 'rebase' | 'tag' | 'delete-branch' | 'rename-branch'

/** An action the person started on a commit, waiting for their confirm; `target` is the branch a delete or rename acts on. */
/**
 * An action asking to be confirmed. `site` is where its confirm line draws: the Branches card (absent: the commit card).
 * `force` is a delete of a branch that is not merged: `git branch -D`, after a harder warning.
 */
export type Pending = { kind: ActionKind; hash: string; target?: string; site?: 'branches'; force?: true }

/** One local branch for the Branches card: its tip, how long ago that was committed, and whether HEAD already has it. */
export type BranchInfo = {
  name: string
  hash: string
  /** `%(committerdate:relative)` shortened, as the rows show it: `3d`. */
  age: string
  /** Seconds since the epoch, for newest first. */
  time: number
  /** `origin/x`, or empty without one. */
  upstream: string
  /** The upstream was deleted on the remote (a merged PR's branch, usually). */
  isGone: boolean
  /** Every commit of it is in HEAD (`git branch --merged`): deleting loses nothing. */
  isMerged: boolean
}

/**
 * One checkout of the repo (`git worktree list --porcelain`): the main one and every linked worktree. A branch checked
 * out in one cannot be checked out, renamed or deleted from another: git refuses.
 */
export type Worktree = {
  /** The absolute path git gives. */
  path: string
  /** The path's last part, as the rows show it. */
  folder: string
  /** The branch it has checked out; null when detached (or bare). */
  branch: string | null
  /** The commit it is on. */
  head: string
  /** The first one git lists: the repo's own folder. */
  isMain: boolean
  /** The one this session (and so this pane) runs in. */
  isHere: boolean
  /** Made by a Claude Code session: under `.claude/worktrees/`. */
  isSession: boolean
  /** Its folder is gone (`prunable`): `git worktree prune` clears it. */
  isGone: boolean
}

/** A pull request title and description drafted for the branch, shown in a card under the header until closed. */
/** `branch` is the branch it was drafted for: Create PR refuses a draft whose branch is no longer the current one. */
export type Summary = { branch: string; base: string; title: string; description: string }

/** What a pull request's checks add up to: `none` when it has no checks. */
export type Checks = 'pass' | 'run' | 'fail' | 'none'

/** The open pull request for the current branch, from `gh pr view`. */
export type PullRequest = {
  number: number
  title: string
  url: string
  /** The branch it merges into, `main`. */
  base: string
  commits: number
  additions: number
  deletions: number
  checks: Checks
  /** How many checks failed. */
  failing: number
  hasConflicts: boolean
}

/** A merge commit as the Main line view draws it. `number` is a GitHub PR's number (null for any other merge); `count` is the commits it brought in (0 when unknown). */
export type Merge = { number: number | null; label: string; additions: number; deletions: number; count: number; authors: string[] }

/** One Main line row: a first-parent commit, with `merge` set when it has two or more parents. */
export type MainRow = { commit: Commit; merge: Merge | null }

/** A commit a merge brought in, listed under its row when opened. */
export type MergeCommit = { hash: string; author: string; subject: string }

/** The merge row opened in place and its commits (newest first, at most the first dozen). */
export type OpenMerge = { hash: string; commits: MergeCommit[] }

export type HistoryView = 'graph' | 'main'

/** What a pull request shows as a pill: its number, whether it is a draft, and what its checks add up to. */
export type PrBadge = { number: number; isDraft: boolean; checks: Checks }

/** A teammate's open pull request, as the Teammates card lists it. */
export type TeammatePr = PrBadge & { title: string; url: string; additions: number; deletions: number; isReviewRequested: boolean }

/** Someone else's branch on origin that is ahead of the base or has an open PR; `updated` is unix seconds. */
export type Teammate = { branch: string; author: string; ahead: number; updated: number; pr: TeammatePr | null }

/** One file of a teammate's branch: git's `--numstat` counts, `-` for a binary file. */
export type TeammateFile = { path: string; additions: string; deletions: string }

/** The teammate row opened in place: its commits and files against the base. */
export type OpenTeammate = { branch: string; commits: MergeCommit[]; files: TeammateFile[] }

declare module 'claude-code' {
  interface PluginState {
    'git-graph': {
      commits: Commit[]
      head: string
      /** Local branch names, sorted, for the header's branch menu. */
      branches: string[]
      /** HEAD's hash, from `# branch.oid`. */
      headHash: string
      files: ChangedFile[]
      /** The paths the person ticked: a selection only. Commit, Stage and Stash act on these. */
      ticked: string[]
      sync: Sync
      /** The commit message being typed. */
      message: string
      /** Bumped when the hooks change the message themselves (a commit clears it), so the editor takes it instead of its own text. */
      editRev: number
      /** Where the editor puts its caret when it takes the hooks' text (after a paste); null puts it at the end. */
      editCaret: number | null
      openFiles: OpenFile[]
      /** The path whose discard confirm is open. */
      confirmDiscard: string | null
      /** Under the Commit row: why Commit did nothing, or a command's failure. */
      changesNote: string | null
      undo: Undo | null
      stashes: Stash[]
      /** The stash index whose drop confirm is open. */
      confirmDrop: number | null
      selected: string | null
      detail: Detail | null
      error: string | null
      /** `git remote get-url origin`, or empty. */
      remote: string
      /** The person closed the pane: it stays closed across surface attaches until `/git-graph`. */
      isClosed: boolean
      pending: Pending | null
      /** What the last action came to, shown under the actions until the next one. */
      note: string | null
      /** The reference panel under the header, opened by the info button. */
      isHelpOpen: boolean
      /** The reference panel's open section by title (one at a time); null when all are folded. */
      helpSection: string | null
      /** How many History rows are drawn; Show more adds a step. */
      historyShown: number
      /** A model call is drafting the commit message: ✎ shows its busy label and a second press does nothing. */
      isWriting: boolean
      /** A model call is drafting the branch summary. */
      isSummarizing: boolean
      /** The drafted pull request text, until the person closes it. */
      summary: Summary | null
      /** The open pull request for the current branch; null when there is none, the branch is not pushed, or gh is unavailable. */
      pr: PullRequest | null
      /** A create, merge or close is running: its button shows a word and does nothing. */
      isPrBusy: boolean
      /** Merge was pressed and is asking, in place of its buttons. */
      isMerging: boolean
      /** A failure or refusal from the last PR action, shown red under the PR or Summary card. */
      prNote: string | null
      /** `gh auth status` succeeded; null until it has been asked. */
      hasGh: boolean | null
      /** Bumped when the hooks change the summary description themselves (a new draft, a paste), so its editor takes it. */
      summaryRev: number
      /** Where the summary editor puts its caret when it takes the hooks' text; null puts it at the end. */
      summaryCaret: number | null
      /** `git config user.name`: the person's own name, so their commits draw blue. Empty when unset. */
      you: string
      /** Hashes on the upstream that HEAD does not have (`git rev-list HEAD..@{u}`): drawn dashed under a band with Pull. Empty when not behind. */
      incoming: string[]
      /** Incoming commit hash to the changed files it also touches (`git log HEAD..@{u} --name-only` against `git status`); empty when none clash. */
      clashes: Record<string, string[]>
      /** Which History the card shows: the lane graph, or the main line with each merged PR as one row. Saved across sessions in the store. */
      historyView: HistoryView
      /** `git log --first-parent` rows, loaded only while historyView is `main`. */
      mainRows: MainRow[]
      /** The merge row opened in place, or null. */
      openMerge: OpenMerge | null
      /** Other people's open PRs and recent branches on origin, newest first; empty without a signed-in gh. */
      teammates: Teammate[]
      /** The teammate row opened in place, or null. */
      openTeammate: OpenTeammate | null
      /** Every open PR by head branch name (the person's own too), for the pill on a branch tip in the graph. */
      openPrs: Record<string, PrBadge>
      /** The switch for a quiet `git fetch` every five minutes while the pane is open; off by default, saved across sessions in the store. */
      isAutoFetch: boolean
      /** Commits HEAD has that its base branch (origin/HEAD, else main or master) does not; 0 on the base, detached, or with no base. Draft PR shows only above 0. */
      aheadOfBase: number
      /** The Branches card under the header, opened from its Branches button. */
      isBranchesOpen: boolean
      /** The local branches with their state, read while the Branches card is open. */
      branchList: BranchInfo[]
      /** How many Branches card rows are drawn; its Show More adds a step, as History's does. */
      branchesShown: number
      /** Every checkout of the repo, read on each refresh: the Worktrees card, the held branches and the header pill. */
      worktrees: Worktree[]
      /** The Worktrees card under the header, opened from the ✿ button beside the branch name. */
      isWorktreesOpen: boolean
      /** The worktree path whose remove confirm is open. */
      confirmRemove: string | null
      /** Bumped on every press in the pane but the message box's own, so the box drops its blinking caret. */
      editorBlur: number
    }
  }
}
