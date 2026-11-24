# Migration manifest binding - proposal for the 08:30 review

**Proposed, unapproved and unarmed.** Recommendation: approve this narrowly
scoped operator successor after reviewing the [combined patch](20261124-migration-binding.proposed.patch).
This decision belongs in the owner's Wednesday 08:30 batch; no early approval
request or hosted action is made here. The independent cap packet is unaffected.

The existing database operator compares its source archive manifest with the
application switch's built-release identity. Those hashes describe different
things. The accepted payload manifest already binds both: the full Git archive
`e8a47fe5...6bf7` and the 291-file application source map `dd33d4d7...e934`.

The proposed binding verifies the original archive, passed rehearsal and actual
payload bytes, exact commit/tree, the builder's exact 291-file selection and
every included file hash. It recomputes the application identity using the
original encoding. The database operator still verifies every archived source
file. It preserves the original operator set under an immutable rehearsed
directory and separately verifies that the executed migration batch is identical.
No original manifest, operator seal or rehearsal result is rewritten.

The receipt conversion requires the actual captured exit code, original
COMMIT_ACKNOWLEDGED result and original H5i attestation bytes, both guard tickets,
exact migration hashes, target, prefixes, row/Auth/privilege/catalog checks and
remaining budget. It emits the existing switch receipt shape with provenance
hashes. It does not infer success from a filename or a hand-authored status.

**50 focused pure checks and four syntax checks passed.** They include actual
retained H5i receipt compatibility, source/proof preservation, altered inputs,
failed/unknown commits, changed targets and write sets. SQL, TLS, guard/deadline,
three backup checks and cleanup sections remain unchanged. The original
source-and-proof function differs only in its explicit rehearsed-directory
references and an additional executed-batch equality check.

The first two pure attempts remain STOP results, 44/45. They exposed differing
write-set array order: the batch sorts by relation, while H5i retains SQL order.
The corrected proposal compares a sorted copy with the existing comparator and
still rejects duplicate relations, changed counts and changed types. Original
receipt bytes and ordering are preserved. No database or apply entrypoint ran.

Open limits: the original rehearsal proves its original body and sources, not
execution of the successor entrypoint. Complete joined timing, genuine hosted
admission and target/TLS checks, and final outer sequencing remain required.
Approval of this proposal alone would not arm a window or waive those checks.

Evidence: [proposal seal](20261124-migration-binding-proposal-seal.json) and
[50-case receipt](20261124-migration-binding-proposed-checks.json). Combined patch
SHA-256: `b753d7ad337b2c47cd8290833757adc07875eaeb56698a0b04e93b9d0a020c73`.

The staged whitespace check reports one required blank context line in the
unified patch (line 9). Its sealed bytes are preserved; the other three receipt
files have no whitespace diagnostic. All four files are UTF-8/LF.
