# Codex subagents

This repository pilots **four project-scoped Codex custom agents**. It does not modify `.agents/skills/`, `plugins/sdlc/`, or the existing SDLC slash-command workflow.

## Agent roster

| Agent | Model | Purpose | Expected file changes |
| --- | --- | --- | --- |
| `repo_explorer` | `gpt-6-luna` (high) | Map relevant files, paths, dependencies, risks | None |
| `implementation_worker` | `gpt-6.1-sol` (medium) | Build one explicitly authorized slice | Scoped application files |
| `test_engineer` | `gpt-6-sol` (medium) | Add/check focused tests and report results | Scoped test files, only when authorized |
| `code_reviewer` | `gpt-6.1-sol` (high) | Independent evidence-based diff review | None |

`.codex/config.toml` enables subagents and limits concurrent spawned threads to three. It does **not** spawn agents automatically or permit work that was not authorized.

## How to try it

1. Open this repository in a current Codex app, IDE extension, or CLI session. Restart or start a fresh session if you just added the agent files.
2. Ask the main Codex chat explicitly to use one or more named subagents:

   ```text
   Spawn repo_explorer to map the code paths and existing tests for <task>.
   Do not edit files. Return paths, dependencies, and open questions.
   ```

   ```text
   Spawn implementation_worker to implement only <approved slice>.
   Follow AGENTS.md and the selected spec, and report changed paths and checks.
   ```

   ```text
   Spawn test_engineer to design and run focused tests for <approved slice>.
   Write test files only if authorized; report pass/fail/not-run separately.
   ```

   ```text
   Spawn code_reviewer to review this branch against main for correctness,
   security, regressions, and missing tests. Read-only; list actionable findings.
   ```

3. For a larger authorized task, the main agent may first request exploration, then delegate an implementation slice, then ask the test engineer and reviewer to assess **non-overlapping** work. Wait for results before summarizing; do not have multiple agents edit the same files at once.
4. In the Codex CLI, use `/subagents` to inspect spawned threads where supported.

If you use an installed `/sdlc:implement <scope>` command, you can **also** request explicit delegation in the same chat message; the slash command remains the workflow entry point. Do not add references to these agents inside the shared SDLC skills.

## Safety and scope

- All roles obey repository `AGENTS.md` and the parent Codex session's permission/sandbox settings. Read-only wording in an agent prompt is behavioral guidance, **not** an isolated filesystem sandbox.
- The main Codex session owns task decomposition, permission decisions, git operations, PR creation, and final synthesis. Subagents do not independently merge, deploy, or run database migrations.
- Use one agent for small tasks; parallelize independent exploration and review before attempting concurrent edits.
- Model names above are those currently visible to this project's operator. If a model is unavailable in a particular Codex client, adjust the role's model to an accessible one and rerun the experiment.
- Suggested first smoke test: spawn `repo_explorer` on a bounded area and check its read-only report. Then run `code_reviewer` on a small PR diff; reserve writing agents for an authorized change.
