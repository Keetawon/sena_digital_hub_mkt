# Timer correction proposal: checked, not applied

The current boundary timer loop's scalar control passes; its single-element-array
input was reproduced as `timer_next_shape_unknown`. The sealed source remains
unchanged, SHA-256
`dd3d84b498ebb97ebc401ea04c260ed65df83e4c3853678e968e849bb5a2b7b1`.

The concrete **unapplied** patch is `20261124-boundary-timer.proposed.patch`,
SHA-256 `867baeb2cf628da254500caa4790044da586ae5c05d260b55eb50259a8d30a30`.
It accepts strict uint64 scalar or single-element-array shapes, refuses booleans
and malformed/out-of-range values, and records shape/value. An unused zero/unset
alternate clock is ignored only when another clock proves a valid deadline.
No valid deadline still means STOP. Earliest-valid selection and all later
remaining-time checks are unchanged.

**24 pure proposal cases passed**, covering scalar/array/mixed shapes, unused
alternate clocks, both clocks unresolved, booleans, overflow/negative values,
empty/multiple/nested arrays, wrong types, strings/floats and missing fields.
These exercise the source-extracted loop and proposed helper only. They are not
complete runtime integration, live admission or approval to apply the patch.
No network, service or database was used.

Exact checks are in `20261124-boundary-timer-proposal-checks.json`; local source
and proposal artifacts remain under
`.local/hosted-content-rollout/marketing-20261124/cap-successors-v1/timer-parser-proposal/`.
Keep this as the already identified new decision in the 16:00 batch; do not ask
again before then or patch sealed operators. The earlier library correction
selected one required clock and cannot be copied blindly into a two-clock loop.

The committed patch uses zero context to avoid whitespace-only context lines in
the receipt. Its proposed source bytes are identical to the tested three-context
patch (`f20003fe822f03afbe731c80c025487c1ed05cf5dae195407c5372ad1a38d537`),
which remains retained locally and referenced in the original check receipt.
Only patch presentation changes; no operator or assertion changes.
