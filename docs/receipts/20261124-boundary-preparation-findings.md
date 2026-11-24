# Boundary preparation findings for the 16:00 decision batch

Read-only source review after the owner's 11:05 decisions. No hosted calls,
credential access, runtime test or sealed-operator edit. Socket rehearsal remains
the owner's one-attempt run; read its result only when the owner reports completion.

## Successor pins prepared; runtime and tests pending

New artifacts are under
`.local/hosted-content-rollout/marketing-20261124/cap-successors-v1/`:

- `switch-v4`: only the approved API/worker values and canonical cap-inventory
  pin differ from the preceding remote source. Reversing those substitutions
  restores the original bytes. Operator SHA-256:
  `9ebd5a2bb967e8b509b9a4665bc2971b8ca6ca9477362bd5116df12ea72db521`.
- `caller-v3`: caller logic, route, launcher properties, pressure policy and
  existing tests remain byte-identical; adjacent operator/inventory pins change.
- `boundary-v6`: successor references/pins change; core, collector, transport,
  scope reader and profile remain byte-identical. Prior component evidence is
  retained as prior evidence, not relabelled as a new full integration pass.

The inventory raw-file SHA is
`940fda38dbe7e4cd5017d8cac88a9bba9bf623083928f7d93c5e395caaf08817`;
its distinct canonical-JSON SHA is
`d6df1c1c2b86ac62f82bae0153828c5804afb11ab4c6ac9eb32ba3f076342cec`.
Only keyed API/worker entries change. The old worker and certificate file hashes
were equal; the certificate entry must not be changed by a global replacement.

Prepared checks retain the 19 switch and 12 caller assertions and the existing
boundary suites. Additional pure checks exercise actual cap-validation logic
against fixture I/O: approved values, old API/worker values, kernel mismatch,
metadata/pin drift, foreign cgroup, wrong OOM score and automatic-restart policy.
They also reject predecessor caller caps/operator/seal pins. These are prepared,
**not yet reported as passing**; they wait for the owner rehearsal and cleanup
before taking the serial lease. No whole product gate is being repeated.

## New decision item 1: timer shape and unused alternate clock

The boundary collector's existing timer loop requires a scalar integer and
rejects a single-element array as `timer_next_shape_unknown`. Complete local
integration must cover both retained timer-response shapes; choosing scalar-only
fixtures would conceal this gap. The collector also uses `isinstance(..., int)`,
which is broader than the previously approved strict integer parser.

The already-approved library helper accepts a strict uint64 scalar or a single
element array, rejecting booleans, malformed values, zero and the unset sentinel.
That caller asks for one required monotonic deadline. The boundary collector asks
for both realtime and monotonic deadlines and currently chooses the earliest
valid one, allowing an unused alternate clock. Copying the strict helper blindly
into both iterations would reject ordinary timers with one unused clock.

**Recommendation for the 16:00 batch:** approve a separate boundary successor
that accepts the same strict scalar/one-element-array shapes, rejects booleans,
wrong types, malformed arrays and out-of-range values, records shape/value,
and preserves current earliest-valid-clock behavior. A zero/unset alternate is
ignored only if the other clock proves a valid deadline; no valid deadline is
still STOP. Keep the remaining-time check unchanged. Preserve and test the
predecessor refusal, both shapes and all malformed/unset combinations. This
correction is proposed only; it has not been applied or silently folded into v6.

## Approved full local integration: implementation boundaries

Use a small controller plus an explicit fixture-I/O adapter. Call the same
successor assembly, core, capture verification and transport functions; never
invoke the hosted CLI with a fabricated live-admission packet. Label every
fixture and the final result LOCAL_FIXTURE_INTEGRATION with hosted acceptance
false. Record production-source, assembled-fixture and actual local argv hashes.

Keep actual local transient-unit execution, original capture stdout/status,
helper/transport ancestry, process start ticks, cgroup memory/events, read-only
mount verification, child limits, wall/monotonic clocks and deadline behavior.
Only enumerated job/journal/config observations use labelled fixtures; unexpected
commands or paths fail closed. Any replayed metadata must be identified as
fixture data, not a measured file fingerprint. Never stub the final collector
observation, cap decision, helper-boundary decision or `core.assess()` result.

The completed maintenance helper must emit its own actual identity and timing;
after exit, prove its recorded PIDs are absent and cgroup empty before the guard.
Preserve failure branches for capture/source changes, foreign or reused PIDs,
residual members, unknown work, incomplete journals, bounded child output and
deadlines. A fast synthetic maintenance helper does not prove migration or
application-promotion timing; that remains a separate bounded rehearsal.

No new question is raised before 16:00 by this receipt. The parser decision is
batched as requested while other local preparation continues. Certificate
offline capacity testing is excluded under the explicit 11:05 risk acceptance;
settings verification and passive ordinary-renewal observation remain required.
