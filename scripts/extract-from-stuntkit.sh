#!/usr/bin/env bash
# Rebuilds this repository from stunt-double/stuntkit's packages/local, keeping
# its history, then replays this repository's own commits (the standalone
# scaffolding) on top.
#
#   scripts/extract-from-stuntkit.sh [branch]     # default: main
#
# Safe to re-run on a later StuntKit branch: git filter-repo is deterministic,
# so the commits already extracted keep their hashes and only new StuntKit
# commits are added beneath the scaffolding.
#
# - Every extracted commit gets a `StuntKit-Commit: <sha>` trailer, and its
#   `(#123)` pull request reference becomes `(stunt-double/stuntkit#123)`.
#   The newest commit with that trailer marks where the extraction ends.
# - `stuntdouble@<version>` tags come across, and a tag is created for any
#   version bump that has none.
# - Pending changesets for `stuntdouble` are copied from StuntKit's
#   `.changeset/` into one commit marked `Carried-From-StuntKit: <sha>`, which a
#   re-run replaces rather than replays.
# - Everything after the extraction, except that commit, is replayed with
#   `git am -3`. On a conflict, resolve it and run `git am --continue`.
#
# Needs git, git-filter-repo (or FILTER_REPO=/path/to/git-filter-repo) and a
# clean working tree. Pushes nothing.
set -euo pipefail

BRANCH="${1:-main}"
STUNTKIT_URL="${STUNTKIT_URL:-https://github.com/stunt-double/stuntkit.git}"
STUDIO_URL="${STUDIO_URL:-https://github.com/stunt-double/studio.git}"
STUDIO_DIR="${STUDIO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FILTER_REPO="${FILTER_REPO:-git-filter-repo}"
EXTRACT_TRAILER='StuntKit-Commit'
CARRY_TRAILER='Carried-From-StuntKit'

command -v "$FILTER_REPO" >/dev/null || {
  echo "git-filter-repo not found: install it, or set FILTER_REPO" >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Cloning $STUNTKIT_URL ($BRANCH)"
git clone --quiet --single-branch --branch "$BRANCH" "$STUNTKIT_URL" "$WORK/stuntkit"
SOURCE_SHA="$(git -C "$WORK/stuntkit" rev-parse HEAD)"
# Dated like the StuntKit commit, so a re-run on the same commit is identical.
SOURCE_DATE="$(git -C "$WORK/stuntkit" log -1 --format=%cI HEAD)"

# Pending changesets that bump `stuntdouble`, with any other package's line
# dropped from the front matter.
mkdir -p "$WORK/changesets"
for f in "$WORK"/stuntkit/.changeset/*.md; do
  [ -e "$f" ] || continue
  [ "$(basename "$f")" = README.md ] && continue
  grep -qE "^['\"]?stuntdouble['\"]?:" "$f" || continue
  awk 'NR==1 && /^---$/ {fm=1; print; next}
       fm && /^---$/ {fm=0; print; next}
       fm {if ($0 ~ /^['\''"]?stuntdouble['\''"]?:/) print; next}
       {print}' "$f" >"$WORK/changesets/$(basename "$f")"
done

echo "==> Filtering to packages/local"
git -C "$WORK/stuntkit" tag -l | { grep -v '^stuntdouble@' || true; } | xargs -r git -C "$WORK/stuntkit" tag -d >/dev/null
(
  cd "$WORK/stuntkit"
  "$FILTER_REPO" --quiet --force --subdirectory-filter packages/local --commit-callback '
import re
msg = re.sub(rb"\(#(\d+)\)", rb"(stunt-double/stuntkit#\1)", commit.message).rstrip(b"\n")
last = msg.split(b"\n")[-1]
sep = b"\n" if re.match(rb"^[A-Za-z-]+: ", last) and b"\n\n" in msg else b"\n\n"
commit.message = msg + sep + b"'"$EXTRACT_TRAILER"': " + commit.original_id + b"\n"
'
)

# A tag for each version bump that has none.
prev=''
for c in $(git -C "$WORK/stuntkit" rev-list --reverse HEAD -- package.json); do
  v="$(git -C "$WORK/stuntkit" show "$c:package.json" | sed -nE 's/^  "version": "([^"]+)".*/\1/p')"
  if [ -n "$v" ] && [ "$v" != "$prev" ] && ! git -C "$WORK/stuntkit" rev-parse -q --verify "refs/tags/stuntdouble@$v" >/dev/null; then
    git -C "$WORK/stuntkit" tag "stuntdouble@$v" "$c"
  fi
  prev="$v"
done

if [ ! -d "$STUDIO_DIR/.git" ]; then
  echo "==> Creating $STUDIO_DIR"
  mkdir -p "$STUDIO_DIR"
  git -C "$STUDIO_DIR" init --quiet --initial-branch=main
fi
cd "$STUDIO_DIR"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$STUDIO_URL"

mkdir -p "$WORK/patches"
if git rev-parse -q --verify HEAD >/dev/null; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "The working tree has changes: commit or discard them first" >&2
    exit 1
  fi
  base="$(git log -1 --format=%H --grep="^$EXTRACT_TRAILER: " HEAD)"
  if [ -n "$base" ]; then
    n=0
    for c in $(git rev-list --reverse --no-merges --invert-grep --grep="^$CARRY_TRAILER: " "$base..HEAD"); do
      n=$((n + 1))
      git format-patch --quiet -1 "$c" --start-number "$n" -o "$WORK/patches"
    done
    echo "==> Saved $n commit(s) to replay"
  fi
fi

git fetch --quiet --force --no-tags "$WORK/stuntkit" "+HEAD:refs/stuntkit/$BRANCH" "+refs/tags/stuntdouble@*:refs/tags/stuntdouble@*"
git checkout --quiet -B main "refs/stuntkit/$BRANCH"
git reset --quiet --hard

if [ -n "$(ls -A "$WORK/changesets")" ]; then
  mkdir -p .changeset
  cp "$WORK"/changesets/*.md .changeset/
  git add .changeset
  GIT_AUTHOR_DATE="$SOURCE_DATE" GIT_COMMITTER_DATE="$SOURCE_DATE" \
    git commit --quiet -s -m "chore: carry pending changesets from StuntKit" -m "$CARRY_TRAILER: $SOURCE_SHA"
  echo "==> Carried $(ls "$WORK/changesets" | wc -l | tr -d ' ') pending changeset(s)"
fi

if [ -n "$(ls -A "$WORK/patches")" ]; then
  echo "==> Replaying the scaffolding"
  if ! git am --quiet -3 --committer-date-is-author-date "$WORK"/patches/*.patch; then
    cp -R "$WORK/patches" "$STUDIO_DIR/.git/stuntkit-patches"
    echo "A commit did not apply. Resolve it, then run \`git am --continue\`." >&2
    echo "The patches are kept in .git/stuntkit-patches." >&2
    trap - EXIT
    exit 1
  fi
fi

echo "==> Done: $(git rev-list --count HEAD) commits on main at $(git rev-parse --short HEAD), from stuntkit@${SOURCE_SHA:0:7}"
git tag -l 'stuntdouble@*' | sed 's/^/    /'
echo "If package.json changed, run \`pnpm install\` and commit pnpm-lock.yaml."
