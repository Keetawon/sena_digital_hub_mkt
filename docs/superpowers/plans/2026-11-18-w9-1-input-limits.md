# W9.1 input limits and supervised request measurements

Owner-approved requirements, 18 November 2026. Execute locally in ws/w9-1-input-limits. No hosted changes; stop HDR-cache/PNG-streaming experiments unless an admitted case fails. No permission, migration or existing-asset change. The page-check reservation is unchanged.

1. Header admission in upload_optimization.py and upload_pipeline.py before new/reused input decode: JPEG <=100M, PNG <=24M at any depth, reject PQ/HLG PNG. Preserve stricter private-exact and existing WebP/SVG limits. PDF <=50 MiB/200 pages; aggregate 240M unique image-object pixels times ceil(bits/8), minimum one. Count masks separately, shared references once, and include forms/inline images. Inspect encoded-image headers for dimension mismatches before expansion. Tests prove early rejection, shared refs, masks and depth weighting.
2. Keep HTTP 429 upload_busy, Retry-After 1, zero queue. Use an OS lock across local API processes. Parent retains authorization, DB and installation; a killable child performs processing, validation and thumbnail rendering. Bounded private file IPC, clean child environment, hard address-space limit, 20-second child deadline, kill/reap before slot release. Test cancellation, timeout, malformed results, no body read while busy, cleanup and recovery. An address-space cap is not an RSS cap.
3. Use safe JPEG draft before full decode when it does not undershoot the required 4096 edge. Preserve original dimensions and metadata/fidelity rules. Test full 6000x4000 decode, large-image reduction and orientation.
4. New Thai messages in docs/47 section 8.5 and API; docs/36 no-permission-change card.
5. Explicit source export to WSL; serial tests/full ASGI upload-route measurements in four-CPU, 2304M, zero-swap transient cgroups. Actual parent/child/IPC/validation/thumbnail/local storage, synthetic authority/SQL fixtures, no hosted DB or network-latency claim. Maximum JPEG/PNG, PDF aggregate/depth/masks, rejections and busy/cancel cases. Target clear margin below 1024 MiB and well under 30s locally. Any unsafe 240M PDF outcome requires a lower-limit proposal, never silent adjustment.

Write failing focused tests first. Run affected tests while iterating, full API for shared-route changes and required production/final gates before delivery. No product delivery until final-source gates pass. Record failures, coverage gaps and hashes in docs/48. No new dependency.


Owner correction after review, 18 November: do not lower PDF aggregate. Add
48 MP weighted per image including attached mask data, retain 240 MP aggregate.
Measure five distinct 48 MP and ten distinct 24 MP images at 50 MiB. A failure
requires a lower per-image proposal, not aggregate reduction. Add WebP24 MP
header admission/Thai error. PNG interlaced margin is accepted as a known risk.
Shared admin upload client retries 429 honoring Retry-After for at most 60s,
with Thai waiting status in both sequential flows, no server queue. Preserve
non-429 failure behavior and access invalidation. Update old HDR acceptance
tests to rejection and complete the full API/delivery gates. Report before
commit. Hosted state and 19 November reservation remain unchanged.


Owner decision,19 November:24MP weighted per PDF image including attached
masks,240MP aggregate,50MiB,200 pages. Standalone limits unchanged. The measured
14.10% margin of the noisy ten24MP50MiB case is accepted as a known risk,
not hosted capacity acceptance. Update current Thai copy and boundary tests,
rerun final-source PDF measurements, full API and the serial delivery gate.
Report before commit. Propose a new owner page-check reservation for approval;
no hosted changes.
