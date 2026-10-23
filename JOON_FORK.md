# Joon Paperclip fork

This fork keeps a small, reviewed patch set on a pinned upstream release.
It is not a separate agent orchestration product.

## Branches and ownership

- `master` mirrors upstream. Do not merge Joon patches into it.
- `joon/stable` starts at upstream `v2026.1012.0`, commit
  `bba6a45f0d364cfd962ac59b3bdf2426a8222adb`, the existing deployment baseline.
- `codex/agent-avatar-backport` contains the first proposed product patch.
- Joon owns its patch review, image builds, qualification and upstream upgrades.
  The separate private operations repository owns deployment configuration.
- Keep the MIT license and contributor notices. Attribute every imported patch.
  Never commit company data, credentials, private operations configuration or
  internal task links to this public fork.

## Validation and release

`Joon fork validation` runs focused avatar coverage, token gates, workspace
 typecheck, unit regression and a workspace build on GitHub-hosted runners.
It has a read-only token, no deployment credentials and no agent/model keys.
Inherited upstream publish, cloud, live-agent and release workflows stay disabled.
Do not enable the upstream AWS runner or publish pipelines for this fork.

The upstream source release can have a stale checked-in lockfile. Follow its
resolution step in CI, then install frozen. Keep generated lockfile changes out
of feature PRs, as required by upstream policy. Before an image is promoted,
retain the resolved lockfile, its hash, source SHA and build provenance together.
Use that exact lockfile for the build; do not resolve dependencies again between
qualification and image creation.

A green unit suite does not establish deployment readiness. Before rollout,
review database migrations (the avatar patch adds none), build an immutable image,
retain a current database/files recovery checkpoint, test asset upload/remove and
fallback in an isolated instance, and replay the hosted synthetic lifecycle.
Keep agents paused during qualification. Require named human merge and release
approval. Pin the promoted image digest in the operations repository. Keep the
previous image digest for rollback. A real upstream schema upgrade needs its own
backup/restore qualification; do not assume an old image can undo migrations.

## Upstream maintenance

Review upstream security fixes and stable releases regularly. Bring a proposed
release into an upgrade branch, review migrations and dependency changes, then
rerun qualification before moving `joon/stable`. Never auto-merge upstream master.
For each patch, record its upstream PR and immutable revision. When a stable
upstream release includes an equivalent fix, remove the Joon patch as part of that
upgrade. Keep business workflows, agent permissions and broker policy in the
operations layer whenever possible; fork only core capabilities that need it.

## Initial patch

Custom agent avatars backport upstream PR
https://github.com/paperclipai/paperclip/pull/15095 at revision
`04a24b134af784e8bd20323f25b4c4364fbec68d` by hitoridewanai. The upstream
PR was open and conflicted with upstream master when reviewed on 22 October 2026.
Joon resolves only the import conflict against its pinned baseline and keeps the
same-origin asset restriction, upload/remove controls and fallback behavior.
The patch adds no database migration or runtime dependency. Asset content stays
behind Paperclip's existing company authorization. Removed/replaced images remain
in asset storage, matching the upstream retention limitation.

## Explicit task-assignment denial patch

Adapted from Marcelo Karval's upstream PR
https://github.com/paperclipai/paperclip/pull/12356 at immutable revision
`9b5ef539f3ccbbd554222e0ff59e1a43e1c5ca33`.
The pinned release has newer agent-creation defaults, so the adaptation keeps
its create/stored permission semantics. An absent assignment flag retains the
legacy default. Explicit false denies assignment for non-CEO agents, including
hiring agents, before scoped-key shortcuts and grants. It preserves receipt of
already assigned work and board authority. New standard-agent activation also
omits incompatible assignment grants. No migration or dependency change is used.
Keep this patch until a qualified upstream release contains equivalent behavior.

## Data-only HTTP callback contract

An opt-in `callback_v1` HTTP payload projects only native agent/run/task IDs and
removes generated runtime capabilities from both payload and context. Default
HTTP agents retain their existing payload. The source tests compare the actual
serialized body against a credential-free consumer fixture and reject unknown
modes or callback template injection before network dispatch. This patch adds
no migration or dependency. It is source-only until the normal source CI,
immutable candidate build and exact-image release approval gates pass. Do not
activate agents or repeat hosted qualification based on unit tests alone.
