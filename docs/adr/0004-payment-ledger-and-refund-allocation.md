# ADR 0004: Manual payment evidence and exact cumulative refunds

Date: 2026-11-16

Status: Accepted for MVP 0.3 development; production limitations remain.

## Context

The first two migrations contain immutable cash-only sales. Their constraints
encode a single rounded cash payment. Reinterpreting these rows as digital or
mixed sales would weaken historical guarantees. External Card/TWINT transfers
and physical cash cannot participate in a SQLite transaction.

## Decision

Add a payment journal and expanded financial aggregates through a new migration.
Keep migrations 0001 and 0002 and their historical financial records unchanged.
Project legacy sales into the expanded read model when viewing history or
preparing refunds; retain their original identities and exact snapshots.

Domain owns integer arithmetic, payment allocation and refund eligibility.
Application coordinates narrow use cases through a synchronous persistence port.
Electron supplies the existing database connection, runtime identifiers and time;
React receives runtime-validated contracts. Fast cash and guided checkout use the
same new settlement operation.

Payment preparation creates a durable reference before the operator reports a
physical or external event. Unconfirmed attempts do not count towards payment.
Confirmation is an operator assertion, never provider verification. Persist that
assertion separately from final sale assembly so a later failure does not erase
evidence. A successful response requires a confirmed database commit. An unknown
reply requires reading the original reference, never repeating the external
transfer automatically.

Digital payments apply exact Rappen. Cash is the final allocation in a mixed
checkout. For subtotal `S` and confirmed digital total `D`, calculate the final
cash amount once as `roundCashRappen(S - D)`. Persist the adjustment relative to
the exact remainder. Applied allocations must sum to the final payable amount;
cash tendered and change are separate values.
New cash tender must also use CHF 0.05 denominations, so change can be returned
in those denominations. Historical legacy cash records retain their original data.

## Refund allocation

Refunds refer to historical sale-item identities and quantities, independently
of current catalog prices or the original payment method. They are separate
immutable records. Pending refund evidence must also prevent overlapping payouts.

Allocate the original paid total over historical units with integer cumulative
prefixes, using persisted sale-item order and ascending unit offsets within each
item. For original subtotal `S > 0`, paid total `P` and exact value prefix `x`,
the allocated prefix is `floor(P * x / S)`, evaluated using BigInt. A selected
contiguous unit interval receives the difference between its two prefixes.
Persist the unit offset, quantity, snapshot base amount and rounding allocation
on the refund. A zero-value sale allocates zero to every unit.

This policy gives nonnegative allocations, avoids independently rounding items,
and telescopes to exactly `P` when all units are refunded. Interleaving refunds of
different items does not change their assigned amounts. It does not promise that
every identical unit receives the same Rappen adjustment.

Cash refunds are accepted only when the selected allocated total is divisible
by five. Otherwise choose Card/TWINT or a different unit selection. The refund is
never independently rounded again; cumulative equality takes priority over
offering an impossible cash denomination.

## Recovery and local administration

Keep original attempts and append reconciliation evidence with explicit reasons.
An investigation must distinguish funds received/returned from a transaction
that did not happen. Closing a case must preserve these assertions and satisfy
the relevant consistency checks before releasing a register or refund lock.
No reconciliation operation executes a provider payment or payout.

An abandoned, uncompleted checkout may contain confirmed partial digital
allocations. Permit excluding such an allocation only after an explicit assertion
that its net amount was already compensated externally. Insert the audit action
and transition atomically; preserve its original amounts, confirmation timestamps
and events. No active prepared/reported/uncertain/confirmed cash attempt may exist,
because changing earlier digital allocations would invalidate that cash quote.
Once all allocations are resolved, the checkout can be cancelled and its saved
cart released. Completed sales require separate refunds instead of this action.

For an uncertain refund, its investigation action supplies the final confirmation
timestamp. Keep the earlier uncertainty-report timestamp separately; it was not
an assertion of a successful payout. Commit the action and accepted refund together.

The MVP has no authentication or roles. The trusted local register window is the
privileged boundary; deliberate confirmation and a reason protect against
accidental actions, not a malicious local operator. Do not expose administration
through the diagnostic Node host or claim that it authenticates an administrator.

## Consequences

There is no atomic transaction spanning the application and the outside world.
Disk failure before durable evidence, lost renderer storage, false operator
assertions and unverified provider outcomes still need human investigation.
Fault-injection tests cover selected commit/rollback boundaries, not arbitrary
hardware power loss. This development milestone does not authorize production
payments, releases, terminal integration or remote administration.
