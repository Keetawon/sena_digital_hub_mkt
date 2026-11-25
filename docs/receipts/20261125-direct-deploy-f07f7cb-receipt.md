# 2026-11-25 Direct Deploy Receipt — `f07f7cb-media-dd33d4d7f14b` + Schema `94` + Protective Caps

Date: 2026-11-25 (completed `~11:34` Bangkok)  
Target Host: `72.62.253.205` (Hub TEST)  
Target Database: `eqlrtevwpyboplljgowo` (Supabase TEST)  
Previous Release: `4b00099-media-00f0f23e0fe3` (schema prefix `88`)  
Deployed Release: `f07f7cb-media-dd33d4d7f14b` (schema prefix `94`, Next.js `BUILD_ID`: `vC5TMEX6DDeqUlSEgDxdH`)

## 1. Pre-Deploy Database Backup

- Dump file (local only): `.local/hosted-content-rollout/marketing-20261125/direct-deploy-1121/test-db-before-89-94.dump`
- Size: `17,166,124` bytes (`~16.37 MiB`)
- `pg_restore --list` TOC entries verified: `3,207`
- SHA-256: `135a5568295b05249607151d5684b6b983561bdac32b903e2fc40366c8e92774`

## 2. Release Upload & Bounded Extraction

- Archive SHA-256 verified locally and on VPS: `c93fd191633cf6d1a59e6d680a46f50e617a933a039927180385ea79308e81c3` (`272,290,559` bytes)
- Extracted inside transient unit `sena-hub-test-direct-extract-1121.service` (`MemoryHigh=320M`, `MemoryMax=376M`, `MemorySwapMax=0`, `CPUQuota=50%`, `OOMScoreAdjust=1000`, `OOMPolicy=kill`)
- Runtime writable directory permissions configured (`apps/admin/.next/cache` owned by `sena-hub-admin:sena-hub-admin`, `.local/assets` owned by `sena-hub-api:sena-hub-api`)
- Offline candidate Python import check (`sena_hub_api.main`, `pyvips`) and Next.js `BUILD_ID` (`vC5TMEX6DDeqUlSEgDxdH`) passed before service stop

## 3. Transactional Schema Migrations (`88 -> 94`)

- Hub TEST units stopped cleanly prior to migration (`4` units inactive, `0` listeners on `18000`/`13000`; unit backups stored in `/root/sena-hub-test-unit-backup-20261125-1121/`)
- Applied inside one transaction (`elapsed_ms: 296583`, zero auth write violations across `513` table-role checks):
  1. `202611090089_content_scopes.sql`
  2. `202611090090_bu_membership.sql`
  3. `202611110091_writing_aid.sql`
  4. `202611130092_home_faq_projection.sql`
  5. `202611130093_upload_optimization.sql`
  6. `202611190094_home_missing_fact.sql`
- Postflight schema count verified: `94` (`last_applied`: `202611190094_home_missing_fact.sql`)

## 4. Protective Memory Caps & Release Switch

- Installed all 6 approved protective cap files (canonical inventory SHA-256: `d6df1c1c2b86ac62f82bae0153828c5804afb11ab4c6ac9eb32ba3f076342cec`):
  - `/etc/systemd/system/sena-hub-test.slice` (`MemoryHigh=2048M`, `MemoryMax=2304M`, `MemorySwapMax=0`)
  - `/etc/systemd/system/sena-hub-test-api.service.d/90-production-protection.conf` (`1024M/1248M`, `OOMScoreAdjust=1000`, `Restart=no`)
  - `/etc/systemd/system/sena-hub-test-admin.service.d/90-production-protection.conf` (`256M/384M`, `OOMScoreAdjust=1000`, `Restart=no`)
  - `/etc/systemd/system/sena-hub-test-media-worker.service.d/90-production-protection.conf` (`128M/160M`, `OOMScoreAdjust=1000`, `Restart=no`)
  - `/etc/systemd/system/sena-hub-test-image-broker.socket.d/90-production-protection.conf` (`4M/8M`, `BindsTo=sena-hub-test-api.service`, `OOMScoreAdjust=1000`)
  - `/etc/systemd/system/sena-hub-test-cert-renew.service.d/90-production-protection.conf` (`96M/128M`, `OOMScoreAdjust=1000`, `Restart=no`)
- Updated 3 unit files for `/srv/sena-hub-test/releases/f07f7cb-media-dd33d4d7f14b` (`sena-hub-test-api.service`, `sena-hub-test-admin.service`, `sena-hub-test-api.service.d/50-thumbnail-cache.conf`), ran `systemd-analyze verify --man=no` and `systemctl daemon-reload`, switched `/srv/sena-hub-test/current`, and started all Hub TEST services cleanly.

## 5. Post-Deploy Live Verification

- `/srv/sena-hub-test/current` -> `/srv/sena-hub-test/releases/f07f7cb-media-dd33d4d7f14b`
- Active Hub units:
  - `sena-hub-test-api.service`: `active` (`MainPID=157763`, `1024M/1248M`, `OOMScoreAdjust=1000`)
  - `sena-hub-test-admin.service`: `active` (`MainPID=157767`, `256M/384M`, `OOMScoreAdjust=1000`)
  - `sena-hub-test-media-worker.service`: `active` (`MainPID=157765`, `128M/160M`, `OOMScoreAdjust=1000`)
  - `sena-hub-test-image-broker.socket`: `active` (`4M/8M`, `OOMScoreAdjust=1000`)
- `sena-hub-test.slice` memory events: `high=0`, `max=0`, `oom=0`, `oom_kill=0`, `oom_group_kill=0`; peak `292.18 MiB`
- HTTPS smoke (`https://72.62.253.205`):
  - `/health`: `200`
  - `/login`: `200`
  - `/v1/projects`, `/v1/web/changes`, `/v1/web/llms.txt`, `/v1/admin/web`: `401` with `Cache-Control: no-store`
- `sena-warehouse-postgres`: `running=true`, `oom=false`, `health=healthy` (untouched)
- Host `MemAvailable`: `13.48 GiB`
