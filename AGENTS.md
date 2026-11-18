# Cash Sloth V3 — Development Rules

These rules apply to all work in this repository. Cash Sloth V3 is a modular,
offline-first POS system for Switzerland. Maintainability, correctness and data
integrity take priority over delivery speed.

## Architecture and platforms

- Keep Domain, Application, Infrastructure, Presentation and Platform separate.
- Domain owns business rules and models, with no dependencies on React, Electron,
  SQLite, Node.js or operating-system APIs.
- Application coordinates use cases and transactions through interfaces (ports)
  and depends on Domain, not on concrete infrastructure or platform adapters.
- Infrastructure implements persistence and technical integrations behind those
  interfaces. Presentation uses application contracts; React must never access
  SQLite or manipulate database records directly.
- Platform provides host adapters and composition for Windows/Electron and future
  Raspberry Pi ARM64/Node.js installations. Share business logic across hosts.
- Prevent circular dependencies and duplicated business rules. Prefer focused
  modules and simple interfaces over unnecessary abstractions.
- Follow the planned TypeScript/React/Electron/Node.js, SQLite/Drizzle and pnpm
  workspace stack. The SQLite driver is undecided: investigate `node:sqlite`
  first, with `better-sqlite3` as a fallback. Justify stack changes and major new
  dependencies with technical evidence and documented compatibility checks.

## Financial integrity

- Represent and calculate money exclusively as integer Rappen. Validate inputs
  and numeric bounds; never use floating-point currency arithmetic.
- Snapshot unit prices when cart items are added. Preserve separate lines when
  historical prices differ. Completed sales are immutable and retain historical
  financial snapshots; refunds create separate auditable records.
- Apply Swiss CHF 0.05 cash rounding only to the remaining cash portion after
  exact digital payments have been accounted for. Keep this calculation shared.
- Make critical sale and refund operations transactional and idempotent. Report
  success only after database commit is confirmed. Enforce refund quantity and
  amount limits against the original sale and previous refunds.
- Database rollback cannot undo physical cash transfers or external payments.
  Record manual confirmations and deviations. Make uncertain completion states
  recoverable without automatically repeating a payment or refund.

## Security and environment separation

- Define narrow IPC/API contracts and validate external input at runtime,
  including IPC messages, API requests, imports and persisted data when loaded
  into trusted business logic. TypeScript types alone are not validation.
- Enforce authorization at privileged boundaries. Expose only the operations
  needed by each caller; never expose unrestricted database, filesystem or
  Node.js access to the renderer.
- Never put secrets or credentials in source code or logs. Avoid sensitive
  payment or customer data in diagnostics.
- Keep application network access explicit, scoped and controlled. Do not add
  hidden outbound calls or make core POS operations depend on internet access.
- Development, Beta and Stable must use distinct databases, configurations and
  data directories. Never modify production data during development or tests.

## Implementation quality

- Use TypeScript strict mode, clear names, focused components and explicit
  contracts. Keep business logic out of UI components and platform adapters.
- Handle failures explicitly and preserve recoverable state. Do not swallow
  errors or report failed or uncertain operations as successful.
- Test relevant behavior and failure paths, especially monetary boundaries,
  rounding, persistence, idempotency and recovery. Validate runtime behavior as
  well as compilation when changing executable code.
- Record significant architecture decisions and compatibility findings in
  concise documentation or Architecture Decision Records when introduced.

## Working process and Git

- Inspect the repository, applicable instructions and affected modules before
  editing. State a concise plan and reuse existing modules and contracts.
- Implement only the requested scope and milestone. Do not implement future
  milestones early, start unrelated setup or silently change the architecture.
- Keep changes small and reviewable. Distinguish working functionality from
  prototypes and placeholders; avoid unrelated refactoring.
- Run checks appropriate to the change. For documentation-only tasks, limit
  checks to document correctness and change scope. Never claim unexecuted tests
  passed; report checks performed, limitations and outstanding issues honestly.
- Summarize completed changes, assumptions and recommended next steps.
- Do not commit, push, merge, create releases or change branch protection rules
  without explicit user authorization.

## Specifications and documentation

- Follow `docs/project-identity.md` in new development documentation and milestone
  reports: use **OP Faultir Chrysos** as the internal codename, **Cash Sloth V3** as
  the public product and **Faultir Softworks** as developer/publisher. The codename
  must not rename existing technical identifiers or replace official branding.

- Keep this file focused on durable development rules. Detailed specifications,
  milestone plans, architecture documentation and decisions belong in `docs/`
  as those documents are created; this rule does not imply they already exist.
- Consult applicable specifications when available and keep documentation aligned
  with changes. Source code and tests establish actual implemented behavior;
  document discrepancies with requirements rather than silently redefining them.
