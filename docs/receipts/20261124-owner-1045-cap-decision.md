# Owner cap decision, 24 November 10:45 Bangkok

Approved for the Wednesday plan only: media worker high/hard **128/160 MiB**,
API high/hard **1024/1248 MiB**; every other limit unchanged. Hard allowances
remain **1248 + 160 + 384 + 8 + 128 + 376 = 2304 MiB**.

Approved successor diff SHA-256:
`13403eb7f0d308374c38cdf28ade583bfec086992f09f1fdfcd31ef0a7ab13be`.
Location: `.local/hosted-capacity-w9-20261116/interim/worker-adjustment-20261124/proposed-config.diff`.
The original six-file diff and all earlier receipts remain intact. The proposal
in `20261124-worker-cap-proposal.md` is retained as reviewed; this decision
changes its approval status without rewriting its history.

Downstream pins must change only in separately identified operator successors,
with their tests. Sealed operators must not be patched. An approved Wednesday
cap window and every docs/51 condition are still required before application.
No hosted operation is armed by this decision or this receipt.

The 10:25 partial page-evidence acceptance and mandatory post-promotion ten-page
check remain. Admin peak at or above 256 MiB or any service at its hard cap means
STOP and a rebalance proposal before marketing review. All other pressure and
warehouse protections remain unchanged. During the later authorized real-data
image import, retain and report media-worker peak memory and memory-event deltas.

Local successor preparation now targets these approved values; it does not
prove runtime behavior until its retained rehearsal result passes. The sealed
release `f07f7cb-media-dd33d4d7f14b` is unchanged.
