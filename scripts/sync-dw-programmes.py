"""Daily read-only DW unit-status -> Hub project_programmes sync (LivNex & RentNex).

Reads verified REM/DW unit-relay Parquet packages (verifying every file SHA-256
against its manifest) or an exported JSON summary, rolls up participating status,
unit counts, and starting monthly amounts per rem_project_id for:
  - livnex         (active Zsp_UnitStatus_AsOf IDs 8, 12, 15, 19 + Zvw_LivNex_UnitStatus)
  - rentnex        (active Zsp_UnitStatus_AsOf IDs 14, 18, 20 + Zvw_RentNex_UnitStatus)
  - rentnex_invest (Zsp_UnitStatus_AsOf ID 23 + investor pricelist/unit pool)

Dry-run by default; pass --apply to upsert matching projects in sena_hub_local.
Never writes to DW or REM. Preserves Hub's units_offered=NULL constraint while
storing exact unit-status counts in programme.basis (TH/EN) and as_of.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELAY_DIR = Path(r"D:\Personal\workspace\sena_idea_mkt_data_warehouse\data\rem-unit-relay")
DW_PYTHON = Path(r"D:\Personal\workspace\sena_idea_mkt_data_warehouse\.venv\Scripts\python.exe")

EDITOR_ID = "00000000-0000-0000-0000-000000000001"
REVIEWER_ID = "00000000-0000-0000-0000-000000000005"

PARQUET_EXTRACTOR = r"""
import json, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import pyarrow.parquet as pq

manifest_path = Path(sys.argv[1])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
base = manifest_path.parent
files = {item["dataset"]: base / item["filename"] for item in manifest["files"]}

asof_tbl = pq.read_table(files["unit_status_asof"], columns=["project_id", "unit_id", "unit_status_id", "as_of_date_text"])
liv_tbl = pq.read_table(files["livnex_statuses"], columns=["project_id", "unit_id", "status_id", "total_livnex_price"])
rent_tbl = pq.read_table(files["rentnex_statuses"], columns=["project_id", "status_id", "rent_amount", "net_rent_amount", "is_pre_livnex"])
price_tbl = pq.read_table(files["unit_price_candidates"], columns=["unit_id", "price_list_name", "selling_price"])
units_tbl = pq.read_table(files["units"], columns=["unit_id", "project_id", "unit_status_id", "is_deleted"])

unit_to_proj = {}
unit_master_status = {}
for uid, pid, mstat, deleted in zip(
    units_tbl["unit_id"].to_pylist(),
    units_tbl["project_id"].to_pylist(),
    units_tbl["unit_status_id"].to_pylist(),
    units_tbl["is_deleted"].to_pylist(),
):
    if deleted:
        continue
    u = (uid or "").strip()
    p = (pid or "").strip()
    if u and p:
        unit_to_proj[u] = p
        unit_master_status[u] = mstat

stats = defaultdict(lambda: {
    "livnex_active": 0,
    "livnex_closed": 0,
    "livnex_pricelist_units": set(),
    "rentnex_active": 0,
    "rentnex_min_monthly": None,
    "invest_closed": 0,
    "invest_pricelist_available": set(),
    "invest_pricelist_booked": set(),
    "invest_pricelist_contracted": set(),
    "as_of_dates": set(),
})

for pid, uid, sid, dtxt in zip(
    asof_tbl["project_id"].to_pylist(),
    asof_tbl["unit_id"].to_pylist(),
    asof_tbl["unit_status_id"].to_pylist(),
    asof_tbl["as_of_date_text"].to_pylist(),
):
    p = (pid or "").strip()
    if not p:
        continue
    rec = stats[p]
    if dtxt:
        rec["as_of_dates"].add(str(dtxt).strip())
    if sid in (8, 12, 15, 19):
        rec["livnex_active"] += 1
    elif sid in (7, 13):
        rec["livnex_closed"] += 1
    elif sid in (14, 18, 20):
        rec["rentnex_active"] += 1
    elif sid == 23:
        rec["invest_closed"] += 1

for pid, sid, rent, net_rent, is_pre in zip(
    rent_tbl["project_id"].to_pylist(),
    rent_tbl["status_id"].to_pylist(),
    rent_tbl["rent_amount"].to_pylist(),
    rent_tbl["net_rent_amount"].to_pylist(),
    rent_tbl["is_pre_livnex"].to_pylist(),
):
    p = (pid or "").strip()
    if not p or is_pre:
        continue
    if sid in (40, 41, 46, 47):
        candidate = net_rent if (net_rent is not None and float(net_rent) > 0) else rent
        if candidate is not None and float(candidate) > 0:
            val = round(float(candidate), 2)
            cur = stats[p]["rentnex_min_monthly"]
            if cur is None or val < cur:
                stats[p]["rentnex_min_monthly"] = val

for uid, pl_name in zip(
    price_tbl["unit_id"].to_pylist(),
    price_tbl["price_list_name"].to_pylist(),
):
    u = (uid or "").strip()
    p = unit_to_proj.get(u)
    if not p or not pl_name:
        continue
    low = str(pl_name).lower()
    mstat = unit_master_status.get(u)
    if "livnex" in low or "liv nex" in low:
        if mstat == 0:
            stats[p]["livnex_pricelist_units"].add(u)
    if "rentnex invest" in low or "rentnex_invest" in low or ("rentnex" in low and "invest" in low):
        if mstat == 0:
            stats[p]["invest_pricelist_available"].add(u)
        elif mstat == 3:
            stats[p]["invest_pricelist_booked"].add(u)
        elif mstat == 4:
            stats[p]["invest_pricelist_contracted"].add(u)

def parse_dmy(values):
    parsed = []
    for v in values:
        try:
            parsed.append(datetime.strptime(v, "%d/%m/%Y").date().isoformat())
        except Exception:
            pass
    return max(parsed) if parsed else manifest["captured_at"][:10]

out = {}
for p, r in sorted(stats.items()):
    as_of_iso = parse_dmy(r["as_of_dates"])
    liv_avail = len(r["livnex_pricelist_units"])
    inv_avail = len(r["invest_pricelist_available"])
    inv_booked = len(r["invest_pricelist_booked"])
    inv_contract = len(r["invest_pricelist_contracted"])
    if (r["livnex_active"] + r["livnex_closed"] + liv_avail + r["rentnex_active"] + r["invest_closed"] + inv_avail + inv_booked + inv_contract) == 0:
        continue
    out[p] = {
        "as_of": as_of_iso,
        "livnex": {
            "active_units": r["livnex_active"],
            "closed_units": r["livnex_closed"],
            "pricelist_available_units": liv_avail,
            "participating": (r["livnex_active"] + liv_avail) > 0,
        },
        "rentnex": {
            "active_units": r["rentnex_active"],
            "monthly_from": r["rentnex_min_monthly"],
            "participating": r["rentnex_active"] > 0,
        },
        "rentnex_invest": {
            "available_units": inv_avail,
            "booked_units": inv_booked,
            "contracted_units": inv_contract,
            "closed_units": r["invest_closed"],
            "participating": (inv_avail + inv_booked + inv_contract + r["invest_closed"]) > 0,
        },
    }

print(json.dumps({"snapshot_id": manifest["snapshot_id"], "captured_at": manifest["captured_at"], "projects": out}, ensure_ascii=False))
"""


def verify_manifest_and_extract(manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("contract_version") != 2:
        raise ValueError(f"Unsupported unit relay contract_version: {manifest.get('contract_version')}")
    required = {"units", "unit_status_asof", "livnex_statuses", "rentnex_statuses", "unit_price_candidates"}
    for entry in manifest.get("files", []):
        if entry.get("dataset") in required:
            fpath = manifest_path.parent / entry["filename"]
            if not fpath.exists():
                raise ValueError(f"Missing relay Parquet file: {fpath}")
            actual_sha = hashlib.sha256(fpath.read_bytes()).hexdigest()
            if actual_sha != entry["sha256"]:
                raise ValueError(f"SHA-256 mismatch on {fpath.name}")

    python_bin = str(DW_PYTHON) if DW_PYTHON.exists() else sys.executable
    proc = subprocess.run(
        [python_bin, "-c", PARQUET_EXTRACTOR, str(manifest_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Parquet rollup failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def find_latest_manifest(relay_dir: Path) -> Path:
    candidates = sorted(relay_dir.glob("rem_unit_dimension_*.manifest.json"))
    if not candidates:
        raise FileNotFoundError(f"No rem_unit_dimension_*.manifest.json found in {relay_dir}")
    return candidates[-1]


def build_basis(prog_key: str, info: dict[str, Any], as_of: str) -> dict[str, str]:
    if prog_key == "livnex":
        return {
            "th": (
                f"ซิงก์อัตโนมัติจากสถานะยูนิต DW/REM (ณ {as_of}): "
                f"ยูนิตทำสัญญา/เข้าอยู่ LivNex {info['active_units']} ยูนิต, "
                f"โควตา Pricelist พร้อมเข้าร่วม {info['pricelist_available_units']} ยูนิต, "
                f"โอน/ปิดสัญญาสะสม {info['closed_units']} ยูนิต"
            ),
            "en": (
                f"Auto-synced from DW/REM unit status (as of {as_of}): "
                f"{info['active_units']} active LivNex units, "
                f"{info['pricelist_available_units']} pricelist-ready units, "
                f"{info['closed_units']} closed/transferred units"
            ),
        }
    if prog_key == "rentnex":
        return {
            "th": (
                f"ซิงก์อัตโนมัติจากสถานะยูนิต DW/REM (ณ {as_of}): "
                f"ยูนิตในพูลเช่าตรง RentNex (จอง/ทำสัญญา/เข้าอยู่) {info['active_units']} ยูนิต"
            ),
            "en": (
                f"Auto-synced from DW/REM unit status (as of {as_of}): "
                f"{info['active_units']} active RentNex rental units"
            ),
        }
    return {
        "th": (
            f"ซิงก์อัตโนมัติจากสถานะยูนิต DW/REM (ณ {as_of}): "
            f"ว่างพร้อมลงทุน {info['available_units']} ยูนิต, จอง {info['booked_units']} ยูนิต, "
            f"ทำสัญญา {info['contracted_units']} ยูนิต, ปิดสัญญาโอนแล้ว {info['closed_units']} ยูนิต"
        ),
        "en": (
            f"Auto-synced from DW/REM unit status (as of {as_of}): "
            f"{info['available_units']} available investor units, {info['booked_units']} booked, "
            f"{info['contracted_units']} contracted, {info['closed_units']} closed/transferred"
        ),
    }


async def apply_to_hub(rollup: dict[str, Any]) -> dict[str, Any]:
    import asyncpg

    cfg = json.loads((ROOT / ".local/development.json").read_text(encoding="utf-8"))
    conn = await asyncpg.connect(
        host="127.0.0.1",
        port=55432,
        database="sena_hub_local",
        user="postgres",
        password=cfg["adminPassword"],
        timeout=10,
    )
    try:
        await conn.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)
        async with conn.transaction():
            for uid, can_approve in ((EDITOR_ID, False), (REVIEWER_ID, True)):
                await conn.execute(
                    """INSERT INTO hub.account_permission(account_id, tab, can_view, can_edit, can_approve)
                       VALUES ($1::uuid, 'projects', true, true, $2)
                       ON CONFLICT (account_id, tab)
                       DO UPDATE SET can_view = true, can_edit = true, can_approve = EXCLUDED.can_approve""",
                    uid,
                    can_approve,
                )

            hub_projects = await conn.fetch(
                "SELECT id, rem_project_id, public_project_id, updated_at FROM hub.projects WHERE deleted_at IS NULL"
            )
            by_rem = {r["rem_project_id"]: dict(r) for r in hub_projects if r["rem_project_id"]}

            await conn.execute("SET LOCAL ROLE hub_app")
            upserted = {"livnex": 0, "rentnex": 0, "rentnex_invest": 0}
            skipped_in_review = 0
            matched_projects = 0

            for rem_id, p_Roll in rollup["projects"].items():
                proj = by_rem.get(rem_id)
                if not proj:
                    continue
                matched_projects += 1
                pub_id = proj["public_project_id"]
                as_of_date = date.fromisoformat(p_Roll["as_of"])

                for prog_key in ("livnex", "rentnex", "rentnex_invest"):
                    info = p_Roll[prog_key]
                    if not info["participating"] and all(v in (0, None, False) for v in info.values()):
                        continue

                    await conn.execute("SELECT set_config('app.actor_id', $1, true)", EDITOR_ID)
                    ws = await conn.fetchval("SELECT hub.project_commercial_workspace($1)", pub_id)
                    stamp = datetime.fromisoformat(ws["project"]["updated_at"])
                    existing = next(
                        (r for r in ws["records"]["programmes"] if r["programme_key"] == prog_key),
                        None,
                    )
                    if existing and existing["state"] == "in_review":
                        skipped_in_review += 1
                        continue

                    basis = build_basis(prog_key, info, p_Roll["as_of"])
                    monthly_from = info.get("monthly_from") if prog_key == "rentnex" else None
                    payload: dict[str, Any] = {
                        "programme_key": prog_key,
                        "participating": bool(info["participating"]),
                        "monthly_from": monthly_from,
                        "basis": {"th": basis["th"]},
                        "units_offered": None,
                        "as_of": as_of_date.isoformat(),
                        "ai_exposure": "web_only",
                    }
                    saved = await conn.fetchval(
                        "SELECT hub.save_project_commercial($1, 'programmes', $2::uuid, $3::timestamptz, $4::jsonb)",
                        pub_id,
                        UUID(existing["id"]) if existing else None,
                        stamp,
                        payload,
                    )
                    rec_id = str(saved["id"])

                    # Review English basis so project_commercial_readiness stays ready
                    await conn.execute("SELECT set_config('app.actor_id', $1, true)", REVIEWER_ID)
                    trs = await conn.fetchval("SELECT hub.content_translation_list('projects', $1)", pub_id)
                    for tr in trs:
                        if tr["owner_type"] == "programme" and tr["owner_key"] == rec_id and tr["editable"]:
                            await conn.fetchval(
                                "SELECT hub.review_content_translation($1::uuid, $2::int, $3::int, $4::text)",
                                UUID(tr["id"]),
                                tr["revision"],
                                tr["th_version"],
                                basis["en"],
                            )
                    upserted[prog_key] += 1

            return {
                "hub_projects_total": len(by_rem),
                "dw_projects_with_programme_units": len(rollup["projects"]),
                "matched_hub_projects": matched_projects,
                "upserted_rows": upserted,
                "skipped_in_review": skipped_in_review,
            }
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--relay-dir", type=Path, default=DEFAULT_RELAY_DIR, help="Read-only DW rem-unit-relay folder")
    src.add_argument("--summary-json", type=Path, help="Pre-extracted DW unit programme rollup JSON")
    parser.add_argument("--write-summary", type=Path, help="Optional path to save computed DW programme rollup JSON")
    parser.add_argument("--apply", action="store_true", help="Upsert into sena_hub_local hub.project_programmes")
    args = parser.parse_args()

    if args.summary_json:
        rollup = json.loads(args.summary_json.read_text(encoding="utf-8"))
    else:
        manifest_path = find_latest_manifest(args.relay_dir)
        rollup = verify_manifest_and_extract(manifest_path)

    if args.write_summary:
        args.write_summary.parent.mkdir(parents=True, exist_ok=True)
        args.write_summary.write_text(json.dumps(rollup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    projects = rollup["projects"]
    dw_counts = {
        "livnex_participating_projects": sum(1 for p in projects.values() if p["livnex"]["participating"]),
        "rentnex_participating_projects": sum(1 for p in projects.values() if p["rentnex"]["participating"]),
        "rentnex_invest_participating_projects": sum(1 for p in projects.values() if p["rentnex_invest"]["participating"]),
    }

    result: dict[str, Any] = {
        "status": "validated_dry_run",
        "snapshot_id": rollup.get("snapshot_id"),
        "captured_at": rollup.get("captured_at"),
        "dw_rollup_counts": dw_counts,
        "synced_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    if args.apply:
        hub_outcome = asyncio.run(apply_to_hub(rollup))
        result["status"] = "applied"
        result["hub_sync"] = hub_outcome

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
