# Worker limit adjustment — proposed, not applied

Owner approval is required. Preserve the original six-file diff and its SHA-256
`b0d532a7b2e46d7a2719aff58334e4dfa52d2abf8a716fe13da21d3a428c7b87`.

| Unit | Proposed high MiB | Proposed hard MiB | Change |
| --- | ---: | ---: | --- |
| API, including application broker | 1024 | 1248 | Hard limit -32 MiB |
| Media worker | 128 | 160 | High +32 MiB; hard +32 MiB |
| Admin | 256 | 384 | None |
| Broker socket | 4 | 8 | None |
| Certificate helper | 96 | 128 | None |
| Sole maintenance helper | 320 | 376 | None |
| Parent TEST slice | 2048 | 2304 | None |

Hard allowances: **1248 + 160 + 384 + 8 + 128 + 376 = 2304 MiB**. Swap remains
zero; +1000 OOM adjustment, OOMPolicy=kill and Restart=no remain unchanged.
The production warehouse and ETL PostgreSQL remain excluded and untouched.

The worker's observed lifetime peak is 115.1875 MiB. Proposed high leaves
12.8125 MiB (10.01% of high); hard leaves 44.8125 MiB (28.01% of hard).
This removes the already-observed violation of the old 96 MiB high threshold
and gives more hard-limit room. It is not proof of the worker's future peak.

The current API lifetime peak was 137.59 MiB. More relevant to the next release,
the final-source local upload worst case peaked at **930.51 MiB**, leaving
317.49 MiB below the proposed 1248 MiB hard limit; the 1024 MiB high reference
margin remains 93.49 MiB (9.13%). This is the later final-source measurement,
not the earlier 879.64 MiB fixture result. It was measured under a 2304 MiB local
probe, not this proposed API envelope; ordinary concurrent reads and admin
proxy buffering were not covered. No hosted capacity or deadline acceptance is
claimed. No input limit or single-job admission rule changes.

Exact proposed successor diff:
`.local/hosted-capacity-w9-20261116/interim/worker-adjustment-20261124/proposed-config.diff`

SHA-256: `13403eb7f0d308374c38cdf28ade583bfec086992f09f1fdfcd31ef0a7ab13be`.
It changes only the worker's high/hard values and API hard value in the original
six-file proposal. Parent, extraction helper, admin, socket and certificate
budgets stay byte-for-byte equivalent. No original proposal/receipt was edited.

After approval, refresh every downstream cap hash/pin in separately identified
operator successors and their tests. Do not patch an already-sealed operator or
present old cap hashes as evidence for this allocation. Apply only in the
separately approved Wednesday cap window after all docs/51 conditions pass.

The post-promotion owner page check remains mandatory before marketing review:
admin at or above 256 MiB, or any service reaching its hard limit, means STOP
and a rebalance proposal. All pressure STOPs also remain active.
