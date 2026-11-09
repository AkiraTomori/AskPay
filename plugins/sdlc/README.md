# SDLC — reusable delivery workflow plugin

The plugin is **project-agnostic**: each invocation discovers the active repository, its `AGENTS.md` (when present), requirements, actual code, architecture and approvals. Do **not** infer stack, phase, branch name or implementation readiness from examples written for another project.

## Available commands

When installed in a host supporting namespaced plugin skills (such as Claude Code), the plugin exposes:

| Role | Slash command | Outcome |
| --- | --- | --- |
| Core | `/sdlc:spec <scope>` | Confirm behavior, scope, acceptance examples and open decisions |
| Core | `/sdlc:design <scope>` | Define UX, interfaces, data semantics and failures |
| Core | `/sdlc:implement <approved-slice>` | Deliver a bounded authorized change |
| Core | `/sdlc:verify <scope>` | Check the actual change with evidence |
| Core | `/sdlc:review <scope>` | Examine risks and correctness |
| Core | `/sdlc:pr <scope>` | Prepare a reviewable PR |
| Optional | `/sdlc:frontend-ui-design <scope>` | UI states, a11y and responsive behavior |
| Optional | `/sdlc:database <scope>` | Data integrity and safe schema evolution |
| Optional | `/sdlc:to-tickets <scope>` | Break approved work into demoable tasks |
| Optional | `/sdlc:tdd <scope>` | Test-first iteration for a chosen behavior |
| Optional | `/sdlc:sign-off <decision>` | Obtain a material owner decision |

The slash namespace is `sdlc`, never a project name. Plugin installation is required before these commands appear; merely merging files into a repository does not install them. Host products differ: where namespaced slash skills are unsupported, call the corresponding skill by its name through that host's skill UI.

## Workflow rules

1. **Context first.** Read the active project's instructions and real implementation state, not another project's feature list or previous phase.
2. **One selected result.** Choose the smallest useful result; clarify material decisions. A runnable foundation is valid for a not-yet-implemented project.
3. **Task-driven, not a rigid gate.** Pick the relevant core skill and optional specialist. No mandatory router or forced full `spec → design → implement → verify → review → pr` chain.
4. **Authorization is per action.** Reading and planning do not authorize implementation. A PR does not authorize merge, production changes, data migrations or deployment.
5. **Verified handoff.** Report what was changed and checked, what was not checked, and outstanding risk. Propose **at most one next exact `/sdlc:<skill> <scope>`** when supported; otherwise name the next skill. Do not execute it automatically.
6. **Reviewable delivery.** Honor the active project's branch strategy, avoid unrelated modifications and distinguish a Draft PR from a merged change.

## Packaging

- `plugin.json`: portable Agent Plugins manifest.
- `.claude-plugin/plugin.json`: compatibility metadata for Claude Code.
- `.codex-plugin/plugin.json`: compatibility metadata for the existing repository's Codex plugin catalog.
- `skills/<name>/SKILL.md`: full, bundled skill instructions; these are available **without** depending on the host project's `.agents/skills` directory.
- `skills/tdd/LICENSE.mattpocock`: upstream attribution carried from the existing TDD skill.

## Claude Code adapter

For installation, permission boundaries and optional Claude subagents, see [Claude Code setup](../../.claude/README.md). This plugin is the canonical skill source; synchronize the existing `.agents/skills/` mirror for other hosts. There is no `.claude/skills/` duplicate.
