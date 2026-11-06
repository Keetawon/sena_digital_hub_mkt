# Historical generator evidence

This file preserves the exact normalized-LF generator bytes recorded by the
3 October 2026 synthetic export manifest. The bytes were recovered from Hub
commit d3ec1d61df7188624f3afb15a8f3e67522e79ce4 and checked against the manifest's
existing checksum. That is the recovery source, not a claim about the checkout
state at the earlier export time.

The export files, timestamps, recorded Hub commit and original checksums remain
unchanged. W4 changes the live generator to use explicit approval and independent
publication, so comparing the historical digest to the current generator would
misrepresent this retained fixture. The provenance test reads this archive as
data; it never executes or imports it. The separate database test continues to
exercise the current generator and guarded publication, withdrawal and rollback.
