"""Private financial workflows; typed inputs, trusted actors and guarded transactions.

The database owns transitions and exact-decimal arithmetic. These routes never
issue campaign names, upload documents, or grant an agency financial access.
"""
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal
import json
import re
from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlsplit
from uuid import UUID

import asyncpg
from fastapi import Depends, Query, Request
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

from .auth import Actor, failure
from .content_permissions import require_content
from .ads import SourceId

CostType = Literal["MEDIA", "AGENCY_FEE", "CHANNEL", "TOOL", "BANK_FEE"]
PaymentMethod = Literal["CORPORATE_CARD", "AGENCY_PO_INVOICE", "PLATFORM_INVOICE", "BANK_TRANSFER"]
Token = Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Z0-9][A-Z0-9_-]{0,39}$")]
Reason = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000), AfterValidator(lambda v: nonblank(v))]
Version = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


def nonblank(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("กรุณาระบุข้อความที่ไม่ว่างและไม่มีอักขระ NUL")
    return value


def money(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?", value):
        raise ValueError("จำนวนเงินต้องเป็นข้อความทศนิยมไม่เกินสองตำแหน่งและไม่ติดลบ")
    return value


Money = Annotated[str, BeforeValidator(money)]


def iso_day(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("วันที่ต้องเป็น YYYY-MM-DD")
    return value


def month_start(value: date) -> date:
    if value.day != 1:
        raise ValueError("เดือนต้องระบุวันที่หนึ่ง")
    return value


Day = Annotated[date, BeforeValidator(iso_day)]
Month = Annotated[date, BeforeValidator(iso_day), AfterValidator(month_start)]


def safe_evidence(value: str) -> str:
    nonblank(value)
    parsed = urlsplit(value)
    secret_keys = {"token", "access_token", "key", "api_key", "apikey", "signature", "sig", "password", "secret"}
    if parsed.username or parsed.password or any(
        key.lower() in secret_keys or key.lower().startswith(("x-amz-", "x-goog-"))
        for key, _ in parse_qsl(parsed.query)
    ):
        raise ValueError("หลักฐานต้องไม่มีข้อมูลเข้าสู่ระบบหรือลิงก์ที่มีรหัสลับ")
    if parsed.scheme and parsed.scheme not in {"https", "http"}:
        raise ValueError("กรุณาใช้เลขเอกสารหรือลิงก์เว็บเป็นหลักฐาน")
    return value


Evidence = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2000), AfterValidator(safe_evidence)]


def offset_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(?:Z|[+-][0-9]{2}:[0-9]{2})", value):
        raise ValueError("เวลาตัดสินใจต้องเป็นข้อความ ISO พร้อมเขตเวลา")
    return value


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Expected(Input):
    expected_version: Version


class CloseInput(Expected):
    reason: Reason


class ReviewInput(CloseInput):
    decision: Literal["APPROVE", "REJECT"]


class Approver(Input):
    name: SourceId
    role_label: SourceId
    decision: Literal["APPROVED", "REJECTED", "IN_REVIEW"]
    decision_at: Annotated[datetime, BeforeValidator(offset_timestamp)]

    @model_validator(mode="after")
    def offset_required(self):
        if self.decision_at.utcoffset() is None:
            raise ValueError("เวลาตัดสินใจต้องมีเขตเวลา")
        return self


class CostBreakdown(Input):
    cost_type: CostType
    amount: Money


def complete_split(gross, media, fee):
    if (media is None) != (fee is None):
        raise ValueError("กรุณาระบุค่าโฆษณาและค่าบริการทั้งสองจำนวน")
    if media is not None and Decimal(media) + Decimal(fee) != Decimal(gross):
        raise ValueError("ค่าโฆษณาและค่าบริการต้องรวมเท่ากับยอดรวม")


class MemoCreate(Input):
    memo_no: Annotated[str, StringConstraints(strict=True, pattern=r"^(MO[0-9]{2}(0[1-9]|1[0-2])[0-9]{3}|M\.COM[0-9]{3}_[0-9]{2})$")]
    subject: Reason
    requesting_bud: Token
    gross_amount: Money
    media_amount: Money | None = None
    fee_amount: Money | None = None
    cost_breakdown: list[CostBreakdown] = Field(default_factory=list, max_length=5)
    mirrored_status: Literal["UNKNOWN", "IN_REVIEW", "APPROVED", "REJECTED", "CANCELLED"] = "UNKNOWN"
    approvers: list[Approver] = Field(default_factory=list, max_length=30)
    approval_date: Day | None = None
    evidence_ref: Evidence | None = None

    @model_validator(mode="after")
    def amount_split(self):
        complete_split(self.gross_amount, self.media_amount, self.fee_amount)
        if self.cost_breakdown:
            if len({item.cost_type for item in self.cost_breakdown}) != len(self.cost_breakdown):
                raise ValueError("ประเภทค่าใช้จ่ายต้องไม่ซ้ำ")
            if sum(Decimal(item.amount) for item in self.cost_breakdown) != Decimal(self.gross_amount):
                raise ValueError("ยอดแยกประเภทต้องรวมเท่ากับยอด Memo")
        return self


class MemoUpdate(Expected):
    subject: Reason | None = None
    requesting_bud: Token | None = None
    gross_amount: Money | None = None
    media_amount: Money | None = None
    fee_amount: Money | None = None
    cost_breakdown: list[CostBreakdown] | None = Field(default=None, max_length=5)
    mirrored_status: Literal["UNKNOWN", "IN_REVIEW", "APPROVED", "REJECTED", "CANCELLED"] | None = None
    approvers: list[Approver] | None = Field(default=None, max_length=30)
    approval_date: Day | None = None
    evidence_ref: Evidence | None = None

    @model_validator(mode="after")
    def edit_required(self):
        if self.model_fields_set == {"expected_version"}:
            raise ValueError("กรุณาระบุข้อมูลที่ต้องการแก้ไข")
        for field in ("subject", "requesting_bud", "gross_amount", "mirrored_status", "approvers", "cost_breakdown"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError("ข้อมูลนี้ห้ามว่าง")
        if self.cost_breakdown and len({item.cost_type for item in self.cost_breakdown}) != len(self.cost_breakdown):
            raise ValueError("ประเภทค่าใช้จ่ายต้องไม่ซ้ำ")
        return self


class MemoAlias(Input):
    memo_id: UUID
    identifier: Annotated[SourceId, Field(max_length=100)]
    reason: Reason
    evidence_ref: Evidence


class BudgetItem(Input):
    cost_type: CostType
    payment_method: PaymentMethod
    amount: Money


class LineComponent(Input):
    component_kind: Literal["PHASE", "POOL", "PROGRAM"]
    rem_project_id: SourceId | None = None
    formatted_mapping: SourceId | None = None
    bud: Token
    gross_amount: Money
    media_amount: Money | None = None
    fee_amount: Money | None = None
    memo_id: UUID | None = None
    observed_memo_no: SourceId | None = None
    fee_po_ref: SourceId | None = None
    budget_items: list[BudgetItem] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def component_shape(self):
        if self.component_kind == "PHASE":
            if self.rem_project_id is None or self.formatted_mapping is None:
                raise ValueError("รายการเฟสต้องมีรหัส REM และกลุ่มโครงการ")
        elif self.rem_project_id is not None or self.formatted_mapping is not None:
            raise ValueError("รายการกองกลางหรือโปรแกรมไม่มีรหัสเฟส")
        complete_split(self.gross_amount, self.media_amount, self.fee_amount)
        if sum(Decimal(item.amount) for item in self.budget_items) > Decimal(self.gross_amount):
            raise ValueError("ยอดรายการแยกประเภทต้องไม่เกินงบรายการ")
        return self


class RevisionFields(Input):
    components: list[LineComponent] = Field(min_length=1, max_length=300)
    permitted_scope_ids: list[UUID] = Field(default_factory=list, max_length=100)
    permitted_agencies: list[Token] = Field(default_factory=list, max_length=100)
    mapping_verified: bool = Field(default=False, strict=True)
    reason: Reason

    @model_validator(mode="after")
    def distinct_members(self):
        phase_ids = [item.rem_project_id for item in self.components if item.component_kind == "PHASE"]
        if len(phase_ids) != len(set(phase_ids)):
            raise ValueError("รหัสเฟสในรายการต้องไม่ซ้ำ")
        for items in (self.permitted_scope_ids, self.permitted_agencies):
            if len(items) != len(set(items)):
                raise ValueError("รายการที่อนุญาตต้องไม่ซ้ำ")
        return self


class LineCreate(RevisionFields):
    kind: Literal["GROUP", "ZONE_POOL", "BRAND_POOL", "CORP_PROGRAM", "BU_PROGRAM"]
    scope_id: UUID | None = None
    month: Month | None = None
    agency: Token | None = None
    program_ref: SourceId | None = None
    period_start_month: Month | None = None
    period_end_month: Month | None = None
    source_kind: Literal["MANUAL"] = "MANUAL"

    @model_validator(mode="after")
    def line_key(self):
        program = self.kind in {"CORP_PROGRAM", "BU_PROGRAM"}
        if program:
            if not self.program_ref or not self.period_start_month or not self.period_end_month:
                raise ValueError("โปรแกรมต้องระบุรหัสและช่วงเดือน")
            if self.period_start_month > self.period_end_month or self.month or self.agency:
                raise ValueError("ช่วงเดือนหรือคีย์โปรแกรมไม่ถูกต้อง")
            if self.kind == "BU_PROGRAM" and not self.scope_id:
                raise ValueError("โปรแกรมหน่วยธุรกิจต้องระบุขอบเขต")
        elif not self.scope_id or not self.month or not self.agency or any(
            value is not None for value in (self.program_ref, self.period_start_month, self.period_end_month)
        ):
            raise ValueError("รายการรายเดือนต้องระบุขอบเขต เดือน และเอเจนซี")
        required = "PHASE" if self.kind == "GROUP" else ("PROGRAM" if program else "POOL")
        if any(item.component_kind != required for item in self.components) or (required != "PHASE" and len(self.components) != 1):
            raise ValueError("รายการย่อยไม่ตรงกับประเภทสายงบ")
        if self.kind == "CORP_PROGRAM" and any(item.bud != "SID" for item in self.components):
            raise ValueError("โปรแกรมองค์กรต้องใช้ BUD SID")
        return self


class RevisionCreate(RevisionFields, Expected):
    pass


class Acknowledgement(Input):
    memo_id: UUID
    reason: Reason


class RevisionConfirm(Input):
    expected_revision_id: UUID | None
    acknowledgements: list[Acknowledgement] = Field(default_factory=list, max_length=300)


class AssignmentCreate(Input):
    code: Annotated[str, StringConstraints(strict=True, pattern=r"^SN[0-9]{7}[2-9A-HJ-NP-Z]$")]
    month: Month
    line_id: UUID
    expected_revision_id: UUID
    reason: Reason | None = None
    correction_target_id: UUID | None = None


class AssignmentReplace(CloseInput):
    line_id: UUID
    expected_revision_id: UUID


class AssignmentAcknowledge(Expected):
    expected_revision_id: UUID


class CorrectionTarget(Input):
    month: Month
    line_id: UUID


class CorrectionCreate(Input):
    observed_code: SourceId
    agency: Token
    month_from: Month
    month_to: Month
    reason: Reason
    evidence_ref: Evidence
    targets: list[CorrectionTarget] = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def exact_months(self):
        count = (self.month_to.year - self.month_from.year) * 12 + self.month_to.month - self.month_from.month + 1
        months = {target.month for target in self.targets}
        if count < 1 or count > 120 or len(months) != count or len(months) != len(self.targets) or any(
            not self.month_from <= item <= self.month_to for item in months
        ):
            raise ValueError("ต้องระบุเป้าหมายหนึ่งรายการต่อเดือนในช่วงที่เลือก")
        return self


class CorrectionApply(CloseInput):
    months: list[Month] = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def unique_months(self):
        if len(self.months) != len(set(self.months)):
            raise ValueError("เดือนที่เลือกต้องไม่ซ้ำ")
        return self


class BudSplit(Input):
    bud: Token
    weight_bps: Annotated[int, Field(strict=True, gt=0, le=10000)]


class MappingDates(Input):
    scope_id: UUID
    valid_from: Day
    valid_to: Day | None = None
    evidence_ref: Evidence

    @model_validator(mode="after")
    def validity(self):
        if self.valid_to is not None and self.valid_to <= self.valid_from:
            raise ValueError("วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น")
        return self


class AdMapping(MappingDates):
    agency: Token
    bud: Token | None = None
    bud_splits: list[BudSplit] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def single_bud_or_split(self):
        if (self.bud is None) == (not self.bud_splits):
            raise ValueError("เลือก BUD เดียวหรือสัดส่วน BUD ที่ยืนยันแล้ว")
        if self.bud_splits and (sum(item.weight_bps for item in self.bud_splits) != 10000 or
                               len({item.bud for item in self.bud_splits}) != len(self.bud_splits)):
            raise ValueError("สัดส่วน BUD ต้องไม่ซ้ำและรวมเท่ากับ 10000")
        return self


class ChannelMapping(MappingDates):
    bud: Token
    plan: Reason
    expected_amount: Money


class AdAccountCreate(Input):
    platform: Literal["META", "GOOGLE", "TIKTOK", "CHATGPT"]
    account_id: SourceId
    label: Reason | None = None
    mapping: AdMapping


class ChannelAccountCreate(Input):
    channel: Literal["LINE_OA"] = "LINE_OA"
    account_id: SourceId | None = None
    label: Reason
    steward_ref: SourceId | None = None
    mapping: ChannelMapping

    @model_validator(mode="after")
    def account_or_reference(self):
        if self.account_id is None and self.steward_ref is None:
            raise ValueError("กรุณาระบุบัญชีจริงหรือรหัสอ้างอิงที่ยังรอตรวจสอบ")
        return self


class AdMappingCreate(Expected):
    mapping: AdMapping


class ChannelMappingCreate(Expected):
    mapping: ChannelMapping


class MappingConfirm(Expected):
    mapping_id: UUID


class MappingClose(MappingConfirm):
    effective_to: Day
    reason: Reason


class CommitmentOccurrence(Input):
    cycle_no: Annotated[int, Field(strict=True, ge=1, le=1200)]
    charge_date: Day
    coverage_start: Month
    coverage_end: Month
    expected_amount: Money

    @model_validator(mode="after")
    def coverage(self):
        if self.coverage_end < self.coverage_start:
            raise ValueError("ช่วงเดือนที่ครอบคลุมไม่ถูกต้อง")
        return self


class CommitmentCover(Input):
    memo_id: UUID
    bud: Token
    coverage_start: Month
    coverage_end: Month
    cap_amount: Money
    component_id: UUID | None = None
    budget_item_id: UUID | None = None
    evidence_ref: Evidence

    @model_validator(mode="after")
    def coverage(self):
        if self.coverage_end < self.coverage_start:
            raise ValueError("ช่วงเดือนที่ครอบคลุมไม่ถูกต้อง")
        if self.budget_item_id is not None and self.component_id is None:
            raise ValueError("รายการงบย่อยต้องมีรายการงบหลักอ้างอิง")
        return self


class CommitmentVersion(Input):
    scope_id: UUID
    bud: Token | None = None
    bud_splits: list[BudSplit] = Field(default_factory=list, max_length=100)
    account_mapping_id: UUID | None = None
    vendor_account_ref: SourceId | None = None
    plan: Reason
    cost_type: CostType
    payment_method: PaymentMethod
    amount_per_cycle: Money
    frequency: Literal["MONTHLY", "ANNUAL"]
    start_date: Day
    end_date: Day
    evidence_ref: Evidence
    occurrences: list[CommitmentOccurrence] = Field(default_factory=list, max_length=1200)
    covers: list[CommitmentCover] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def scope_and_schedule(self):
        if self.end_date < self.start_date:
            raise ValueError("วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น")
        if (self.bud is None) == (not self.bud_splits):
            raise ValueError("เลือก BUD เดียวหรือสัดส่วน BUD ที่ยืนยันแล้ว")
        if self.bud_splits and (sum(item.weight_bps for item in self.bud_splits) != 10000 or
                               len({item.bud for item in self.bud_splits}) != len(self.bud_splits)):
            raise ValueError("สัดส่วน BUD ต้องไม่ซ้ำและรวมเท่ากับ 10000")
        if self.account_mapping_id is None and self.vendor_account_ref is None:
            raise ValueError("กรุณาเลือกบัญชีที่ตรวจสอบแล้วหรือเลขบัญชีผู้ให้บริการ")
        if self.account_mapping_id is not None and self.vendor_account_ref is not None:
            raise ValueError("กรุณาเลือกบัญชีอ้างอิงเพียงหนึ่งรูปแบบ")
        if len({item.cycle_no for item in self.occurrences}) != len(self.occurrences):
            raise ValueError("รอบเรียกเก็บต้องไม่ซ้ำ")
        return self


class CommitmentCreate(Input):
    vendor: Reason
    version: CommitmentVersion


class CommitmentRevise(Expected):
    version: CommitmentVersion


class CommitmentActivate(Expected):
    version_id: UUID
    expected_current_version_id: UUID | None
    acknowledgements: list[Acknowledgement] = Field(default_factory=list, max_length=300)


class CommitmentCoverCreate(Expected):
    version_id: UUID
    cover: CommitmentCover


class CommitmentOccurrenceCreate(Expected):
    version_id: UUID
    occurrence: CommitmentOccurrence


class StatementCreate(Input):
    operator_ref: SourceId
    issuer: Reason
    cycle_start: Day
    cycle_end: Day
    due_date: Day
    declared_total: Money
    total_meaning: Literal["NET_CHARGES", "REVIEW_REQUIRED"]
    evidence_ref: Evidence
    review_status: Literal["DRAFT", "CONFIRMED"] = "DRAFT"

    @model_validator(mode="after")
    def cycle(self):
        if self.cycle_start > self.cycle_end or self.due_date < self.cycle_end:
            raise ValueError("รอบใบแจ้งยอดและวันครบกำหนดไม่ถูกต้อง")
        if self.total_meaning == "REVIEW_REQUIRED" and self.review_status == "CONFIRMED":
            raise ValueError("ต้องตรวจสอบความหมายของยอดก่อนยืนยัน")
        return self


class StatementUpdate(StatementCreate, Expected):
    pass


class CardBatchConfirm(CloseInput):
    expected_previous_batch_id: UUID | None


class EvidenceReferences(Input):
    M: Evidence | None = None
    S: Evidence | None = None
    V: Evidence | None = None
    P: Evidence | None = None
    T: Evidence | None = None
    A: Evidence | None = None
    C: Evidence | None = None
    F: Evidence | None = None


class ClassifiedCost(Input):
    cost_type: CostType
    amount: Money
    direction: Literal["DEBIT", "CREDIT"]
    vendor: Reason | None = None
    scope_id: UUID | None = None
    bud: Token | None = None
    account_mapping_id: UUID | None = None
    memo_id: UUID | None = None
    observed_memo_no: SourceId | None = None
    commitment_occurrence_id: UUID | None = None
    line_id: UUID | None = None
    evidence_refs: EvidenceReferences = Field(default_factory=EvidenceReferences)
    refund_of: UUID | None = None

    @model_validator(mode="after")
    def refund_link(self):
        if (self.direction == "CREDIT") != (self.refund_of is not None):
            raise ValueError("รายการคืนเงินต้องระบุค่าใช้จ่ายต้นทางอย่างชัดเจน")
        return self


class CostClassify(Expected):
    costs: list[ClassifiedCost] = Field(min_length=1, max_length=100)


class AllocationItem(Input):
    month: Month
    scope_id: UUID
    bud: Token
    amount: Money


class CostAllocate(Expected):
    expected_allocation_set_id: UUID | None
    method: Literal["EQUAL_MONTHS", "EXPLICIT"]
    coverage_start: Month | None = None
    coverage_end: Month | None = None
    scope_id: UUID | None = None
    bud: Token | None = None
    bud_splits: list[BudSplit] = Field(default_factory=list, max_length=100)
    allocations: list[AllocationItem] = Field(default_factory=list, max_length=1200)
    reason: Reason

    @model_validator(mode="after")
    def schedule(self):
        if self.method == "EQUAL_MONTHS":
            if not self.coverage_start or not self.coverage_end or not self.scope_id or self.allocations:
                raise ValueError("กรุณาระบุช่วงเดือน ขอบเขต และ BUD สำหรับการเฉลี่ยรายเดือน")
            months = (self.coverage_end.year - self.coverage_start.year) * 12 + self.coverage_end.month - self.coverage_start.month + 1
            if not 1 <= months <= 120:
                raise ValueError("ช่วงเดือนต้องอยู่ระหว่างหนึ่งถึง 120 เดือน")
            if (self.bud is None) == (not self.bud_splits):
                raise ValueError("เลือก BUD เดียวหรือสัดส่วน BUD ที่ยืนยันแล้ว")
            if self.bud_splits and (sum(item.weight_bps for item in self.bud_splits) != 10000 or
                                   len({item.bud for item in self.bud_splits}) != len(self.bud_splits)):
                raise ValueError("สัดส่วน BUD ต้องไม่ซ้ำและรวมเท่ากับ 10000")
        elif not self.allocations or any(value is not None for value in (self.coverage_start, self.coverage_end, self.scope_id, self.bud)) or self.bud_splits:
            raise ValueError("การระบุเองต้องส่งรายการรายเดือนเท่านั้น")
        keys = [(item.month, item.scope_id, item.bud) for item in self.allocations]
        if len(keys) != len(set(keys)):
            raise ValueError("เดือน ขอบเขต และ BUD ในตารางจัดสรรต้องไม่ซ้ำ")
        return self


class ListFilters(Input):
    q: Annotated[str, StringConstraints(max_length=200, pattern=r"^[^\x00]*$")] = ""
    month: Month | None = None
    agency: Token | None = None
    bud: Token | None = None
    scope_id: UUID | None = None
    status: Annotated[str, StringConstraints(max_length=40, pattern=r"^[A-Z_]+$")] | None = None
    limit: Annotated[int, Field(ge=1, le=100)] = 25
    offset: Annotated[int, Field(ge=0, le=2147483647)] = 0


def decode_finance(value):
    """Decode PostgreSQL JSON text without passing money through binary floats."""
    if isinstance(value, str):
        value = json.loads(value, parse_float=Decimal)
    money_keys = {"amount", "gross_amount", "media_amount", "fee_amount", "expected_amount", "cap_amount",
                  "statement_total", "declared_total", "control_total", "debit_total", "credit_total", "net_total",
                  "difference", "allocated_amount", "unallocated_amount", "remaining_cap", "cycle_amount", "amount_per_cycle",
                  "observed_memo_gross", "memo_gross", "applicable_allocated_gross", "total_amount", "signed_amount",
                  "actual_consumption", "forecast_amount", "reserved_amount"}

    def convert(item, key=None):
        if isinstance(item, Decimal) or (key in money_keys and isinstance(item, int) and not isinstance(item, bool)):
            return format(item, ".2f")
        if isinstance(item, dict):
            return {name: convert(content, name) for name, content in item.items()}
        if isinstance(item, list):
            return [convert(content) for content in item]
        return item

    return convert(value)


def register_finance_routes(app, authentication, database):
    async def staff(request: Request, actor: Actor = Depends(authentication)):
        require_content(request, error_code="finance_forbidden")
        return actor

    @asynccontextmanager
    async def finance_database(request, actor):
        try:
            async with database(request, actor) as connection:
                yield connection
        except asyncpg.PostgresError as error:
            messages = {
                "23514": (422, "invalid_finance_data", "ข้อมูลยังไม่ผ่านเงื่อนไข กรุณาตรวจยอดเงิน ช่วงเวลา และหลักฐาน"),
                "23503": (422, "invalid_finance_reference", "ไม่พบรายการอ้างอิงที่ใช้งานได้ กรุณาเลือกข้อมูลใหม่"),
                "23505": (409, "finance_conflict", "ข้อมูลซ้ำหรือมีรายการที่ใช้อยู่แล้ว กรุณาตรวจรายการล่าสุด"),
                "40001": (409, "finance_stale", "ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก"),
                "42501": (403, "finance_forbidden", "สิทธิ์ของคุณไม่อนุญาตให้ดำเนินการนี้"),
                "P0002": (404, "finance_not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง"),
                "22003": (422, "invalid_finance_amount", "จำนวนเงินเกินช่วงที่รองรับ"),
                "22007": (422, "invalid_finance_date", "รูปแบบวันที่ไม่ถูกต้อง"),
                "22P02": (422, "invalid_finance_value", "รูปแบบข้อมูลไม่ถูกต้อง"),
                "22023": (422, "invalid_finance_data", "ข้อมูลยังไม่ผ่านเงื่อนไข กรุณาตรวจยอดเงิน ช่วงเวลา และหลักฐาน"),
            }
            if error.sqlstate in messages:
                raise failure(*messages[error.sqlstate]) from None
            raise

    prefix = "/v1/admin/ads"

    async def read(request, actor, resource, key=None, filters=None):
        async with finance_database(request, actor) as connection:
            result = decode_finance(await connection.fetchval(
                "SELECT ads.finance_read($1,$2,$3::jsonb)::text", resource, key, filters or {},
            ))
        if result is None:
            raise failure(404, "finance_not_found", "ไม่พบรายการที่มีสิทธิ์เข้าถึง")
        return result

    def add_read(path, resource):
        async def listing(request: Request, filters: Annotated[ListFilters, Query()], actor: Actor = Depends(staff)):
            criteria = filters.model_dump(mode="json", exclude_none=True)
            criteria["search"] = criteria.pop("q")
            result = await read(request, actor, resource, filters=criteria)
            return {"data": result["items"], "meta": {"total": result["total"], "limit": filters.limit, "offset": filters.offset}}

        async def detail(record_id: UUID, request: Request, actor: Actor = Depends(staff)):
            return {"data": await read(request, actor, resource, str(record_id))}

        app.add_api_route(prefix + "/" + path, listing, methods=["GET"], name="finance_" + resource + "_list")
        app.add_api_route(prefix + "/" + path + "/{record_id}", detail, methods=["GET"], name="finance_" + resource + "_detail")

    for path, resource in {
        "memos": "memos", "media-lines": "media-lines", "line-assignments": "line-assignments",
        "corrections": "corrections", "ledger-imports": "ledger-imports", "ad-accounts": "ad-accounts",
        "channel-accounts": "channel-accounts", "commitments": "commitments", "card-statements": "statement-controls",
        "card-imports": "card-imports", "cost-records": "costs", "document-requirements": "document-requirements",
        "memo-identifiers": "memo-identifiers",
    }.items():
        add_read(path, resource)

    def add_command(path, action, model, *, method="POST", status=200, id_field="id"):
        # Static typed routes share transport only; clients cannot choose an RPC or actor.
        async def endpoint(body, request: Request, actor: Actor = Depends(staff)):
            payload = body.model_dump(mode="json", exclude_unset=True)
            for source, target in (("record_id", id_field), ("revision_id", "revision_id")):
                if source in request.path_params:
                    try:
                        payload[target] = str(UUID(request.path_params[source]))
                    except ValueError:
                        raise failure(422, "invalid_finance_id", "รูปแบบรหัสรายการไม่ถูกต้อง") from None
            async with finance_database(request, actor) as connection:
                result = decode_finance(await connection.fetchval("SELECT ads.finance_command($1,$2::jsonb)::text", action, payload))
            return {"data": result}

        endpoint.__annotations__["body"] = model
        app.add_api_route(prefix + path, endpoint, methods=[method], status_code=status, name="finance_" + action)

    add_command("/memos", "memo_create", MemoCreate, status=201)
    add_command("/memos/{record_id}", "memo_update", MemoUpdate, method="PATCH")
    add_command("/memos/{record_id}/confirm-record", "memo_confirm", Expected)
    add_command("/memo-identifiers", "memo_identifier_propose", MemoAlias, status=201)
    add_command("/memo-identifiers/{record_id}/review", "memo_identifier_review", ReviewInput)
    add_command("/memo-identifiers/{record_id}/retire", "memo_identifier_retire", CloseInput)
    add_command("/media-lines", "line_create", LineCreate, status=201)
    add_command("/media-lines/{record_id}/revisions", "revision_create", RevisionCreate, status=201)
    add_command("/media-lines/{record_id}/revisions/{revision_id}", "revision_update", RevisionCreate, method="PATCH")
    add_command("/media-lines/{record_id}/revisions/{revision_id}/confirm", "revision_confirm", RevisionConfirm)
    add_command("/media-lines/{record_id}/archive", "line_archive", CloseInput)
    add_command("/line-assignments", "assignment_create", AssignmentCreate, status=201)
    add_command("/line-assignments/{record_id}/replace", "assignment_replace", AssignmentReplace)
    add_command("/line-assignments/{record_id}/end", "assignment_end", CloseInput)
    add_command("/line-assignments/{record_id}/acknowledge", "assignment_acknowledge", AssignmentAcknowledge)
    add_command("/corrections", "correction_create", CorrectionCreate, status=201)
    add_command("/corrections/{record_id}/review", "correction_review", ReviewInput)
    add_command("/corrections/{record_id}/apply", "correction_apply", CorrectionApply)
    add_command("/corrections/{record_id}/retire", "correction_retire", CloseInput)
    add_command("/ad-accounts", "ad_account_create", AdAccountCreate, status=201)
    add_command("/ad-accounts/{record_id}/versions", "ad_account_version_create", AdMappingCreate, status=201)
    add_command("/ad-accounts/{record_id}/versions/confirm", "ad_account_version_confirm", MappingConfirm)
    add_command("/ad-accounts/{record_id}/versions/close", "ad_account_version_close", MappingClose)
    add_command("/channel-accounts", "channel_account_create", ChannelAccountCreate, status=201)
    add_command("/channel-accounts/{record_id}/versions", "channel_account_version_create", ChannelMappingCreate, status=201)
    add_command("/channel-accounts/{record_id}/versions/confirm", "channel_account_version_confirm", MappingConfirm)
    add_command("/channel-accounts/{record_id}/versions/close", "channel_account_version_close", MappingClose)
    add_command("/commitments", "commitment_create", CommitmentCreate, status=201)
    add_command("/commitments/{record_id}/revisions", "commitment_revise", CommitmentRevise, status=201)
    add_command("/commitments/{record_id}/activate", "commitment_activate", CommitmentActivate)
    add_command("/commitments/{record_id}/suspend", "commitment_suspend", CloseInput)
    add_command("/commitments/{record_id}/covers", "commitment_cover_create", CommitmentCoverCreate, status=201)
    add_command("/commitments/{record_id}/occurrences", "commitment_occurrence_create", CommitmentOccurrenceCreate, status=201)
    add_command("/card-statements", "statement_create", StatementCreate, status=201)
    add_command("/card-statements/{record_id}", "statement_update", StatementUpdate, method="PATCH")
    add_command("/card-imports/{record_id}/confirm", "card_batch_confirm", CardBatchConfirm)
    add_command("/card-imports/{record_id}/replace", "card_batch_replace", CardBatchConfirm)
    add_command("/card-import-rows/{record_id}/classify", "cost_classify", CostClassify, id_field="source_row_id")
    add_command("/cost-records/{record_id}/allocations", "cost_allocate", CostAllocate)

    @app.get(prefix + "/registrations/{code}/line-candidates")
    async def candidates(code: SourceId, request: Request, month: Month, actor: Actor = Depends(staff)):
        return {"data": await read(request, actor, "line-candidates", code, {"month": month.isoformat()})}

    @app.get(prefix + "/registrations/{code}/monthly-lines")
    async def monthly_lines(code: SourceId, request: Request, actor: Actor = Depends(staff)):
        return {"data": await read(request, actor, "registration-monthly-lines", code)}
