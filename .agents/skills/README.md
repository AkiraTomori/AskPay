# Reusable SDLC Skills

Small, task-selected skills for **any software project**. The skills define working methods, not a product, framework, database, provider, repository layout, branch or release phase.

| Role | Skill | Use it for |
| --- | --- | --- |
| Core | **spec** | Clarify purpose, scope, acceptance behavior and decisions |
| Core | **design** | Work through UX, responsibilities, interfaces and data behavior |
| Core | **implement** | Deliver an explicitly selected vertical slice or enabling task |
| Core | **verify** | Test the observable behavior and report real evidence |
| Core | **review** | Assess the actual change and unresolved risks |
| Core | **pr** | Propose a scoped Git change for human review |
| Optional | **frontend-ui-design** | UI details, accessibility, responsive and localization states |
| Optional | **database** | Persistence, integrity, migrations and data compatibility |
| Optional | **to-tickets** | Break confirmed work into small, demoable tasks |
| Optional | **tdd** | Red → Green → Refactor at a useful behavior seam |
| Optional | **sign-off** | Resolve a material human decision only when needed |

## Project context and authority

1. Inspect the **current repository's** `AGENTS.md`, active specifications, code, constraints and configured tools. Resolve the source of truth from that project, not from these skill files.
2. Choose the one matching skill; involve an optional specialist only when the task needs it. No mandatory router, ceremony or automatic chain of skills.
3. Determine the project's actual mode (discovery, design, implementation, maintenance or operations) from its current evidence and the user's request. Never assume a particular project's phase applies globally.
4. Before implementation, identify an explicitly selected outcome, useful acceptance examples and key dependencies. Start with one end-to-end slice; a small runnable foundation task is valid when the application does not yet exist.
5. Follow the repo's chosen stack, conventions, branch strategy and approval boundaries. Preserve other work; ask before migrations against existing data, production changes, external provisioning, destructive actions or merging.
6. State what actually ran and what remains unverified. Do not infer implementation readiness from document existence alone.

Project-specific adapters may import these skills, but their naming, paths and example content are **not prerequisites** for using the skills in another repository.

## Portable plugin and command handoff

These same skill methods are bundled inside [`plugins/sdlc/`](../../plugins/sdlc/README.md), so installation in another repository does not require copying another project's folder layout. Where a host supports namespaced plugin slash skills, invoke `/sdlc:<skill> <scope>` after installing the plugin; otherwise select the corresponding skill in that host. At each handoff, recommend at most one next scoped skill/command (when appropriate), without running it automatically. Current project policies stay in its own `AGENTS.md` and specs.
