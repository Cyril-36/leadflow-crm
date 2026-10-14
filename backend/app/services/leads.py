"""Lead business rules (PLAN.md §4). Routers stay thin; everything decided here."""

from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.clock import Clock
from app.db import begin_write
from app.errors import AppError, field_error, lead_not_found
from app.models import STATUS_LABELS, Entry, EntryKind, Lead, LeadStatus
from app.schemas import (
    DiscussionCreate,
    EntryOut,
    FollowUpSet,
    LastNote,
    LeadCreate,
    LeadDetailsUpdate,
    LeadListOut,
    LeadOut,
    MutationOut,
)


def resolve_zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    # OSError: a tzdata directory such as "America" or "Etc" raises IsADirectoryError.
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise AppError(
            422,
            "invalid_timezone",
            f"Unknown timezone '{tz}'. Use an IANA name such as 'Asia/Kolkata'.",
            [{"field": "tz", "message": "Unknown IANA timezone."}],
        ) from None


def local_day_bounds(now: datetime, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """UTC instants of the start of today and tomorrow in `zone`.

    Built from local midnights rather than now ± 24 h, so 23- and 25-hour DST days are
    right. If midnight falls in a DST gap, fold=0 maps it to the transition instant,
    which is still the first moment of that local date.
    """
    today = now.astimezone(zone).date()
    start = datetime.combine(today, time.min, tzinfo=zone)
    end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def _begin_write(session: Session, clock: Clock) -> datetime:
    """Take the write lock, then read the clock, so timestamps follow commit order."""
    begin_write(session)
    return clock()


def _get_lead(session: Session, lead_id: int) -> Lead:
    lead = session.get(Lead, lead_id)
    if lead is None:
        raise lead_not_found(lead_id)
    return lead


def _latest_notes(session: Session, lead_ids: Sequence[int] | None = None) -> dict[int, Entry]:
    """The newest `note` entry per lead. System entries never count as a discussion."""
    rank = (
        func.row_number()
        .over(partition_by=Entry.lead_id, order_by=(Entry.created_at.desc(), Entry.id.desc()))
        .label("rank")
    )
    ranked = select(Entry.id, rank).where(Entry.kind == EntryKind.NOTE)
    if lead_ids is not None:
        ranked = ranked.where(Entry.lead_id.in_(lead_ids))
    ranked_sub = ranked.subquery()
    rows = session.scalars(
        select(Entry).join(ranked_sub, Entry.id == ranked_sub.c.id).where(ranked_sub.c.rank == 1)
    )
    return {entry.lead_id: entry for entry in rows}


def _lead_out(lead: Lead, last_note: Entry | None, now: datetime) -> LeadOut:
    follow_up = lead.next_follow_up_at
    return LeadOut(
        id=lead.id,
        name=lead.name,
        company=lead.company,
        phone=lead.phone,
        status=lead.status,
        next_follow_up_at=follow_up,
        follow_up_overdue=follow_up is not None and follow_up < now,
        last_note=(LastNote(body=last_note.body, at=last_note.created_at) if last_note else None),
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def _single_lead_out(session: Session, lead: Lead, now: datetime) -> LeadOut:
    return _lead_out(lead, _latest_notes(session, [lead.id]).get(lead.id), now)


def _commit(session: Session, lead: Lead, entry: Entry | None, now: datetime) -> MutationOut:
    """Build the response inside the write transaction, then commit it."""
    session.flush()
    out = MutationOut(
        lead=_single_lead_out(session, lead, now),
        entry=EntryOut.model_validate(entry) if entry else None,
    )
    session.commit()
    return out


def list_leads(
    session: Session,
    now: datetime,
    tz: str,
    status: LeadStatus | None = None,
    q: str | None = None,
) -> LeadListOut:
    zone = resolve_zone(tz)
    stmt = select(Lead)
    if status is not None:
        stmt = stmt.where(Lead.status == status)
    query = (q or "").strip()
    if query:
        stmt = stmt.where(
            or_(
                Lead.name.icontains(query, autoescape=True),
                Lead.company.icontains(query, autoescape=True),
            )
        )
    leads = session.scalars(stmt).all()
    notes = _latest_notes(session)
    day_start, day_end = local_day_bounds(now, zone)

    # Filters are applied first; the result is then partitioned so each lead appears once.
    pinned: list[LeadOut] = []
    rest: list[LeadOut] = []
    for lead in leads:
        out = _lead_out(lead, notes.get(lead.id), now)
        follow_up = lead.next_follow_up_at
        if follow_up is not None and day_start <= follow_up < day_end:
            pinned.append(out)
        else:
            rest.append(out)

    pinned.sort(key=lambda lead: (lead.next_follow_up_at, lead.id))

    def rest_key(lead: LeadOut) -> tuple[int, float, int]:
        if lead.follow_up_overdue and lead.next_follow_up_at is not None:
            return (0, lead.next_follow_up_at.timestamp(), lead.id)
        activity = lead.last_note.at if lead.last_note else lead.created_at
        return (1, -activity.timestamp(), -lead.id)

    rest.sort(key=rest_key)
    return LeadListOut(pinned=pinned, leads=rest)


def get_lead(session: Session, now: datetime, lead_id: int) -> LeadOut:
    return _single_lead_out(session, _get_lead(session, lead_id), now)


def get_timeline(session: Session, lead_id: int) -> list[EntryOut]:
    _get_lead(session, lead_id)
    entries = session.scalars(
        select(Entry)
        .where(Entry.lead_id == lead_id)
        .order_by(Entry.created_at.desc(), Entry.id.desc())
    )
    return [EntryOut.model_validate(entry) for entry in entries]


def create_lead(session: Session, clock: Clock, data: LeadCreate) -> MutationOut:
    now = _begin_write(session, clock)
    lead = Lead(
        name=data.name,
        company=data.company,
        phone=data.phone,
        status=LeadStatus.NEW,
        created_at=now,
        updated_at=now,
    )
    session.add(lead)
    session.flush()
    entry = Entry(lead_id=lead.id, kind=EntryKind.LEAD_CREATED, body="Lead created", created_at=now)
    session.add(entry)
    return _commit(session, lead, entry, now)


def update_status(
    session: Session, clock: Clock, lead_id: int, new_status: LeadStatus
) -> MutationOut:
    now = _begin_write(session, clock)
    lead = _get_lead(session, lead_id)
    if lead.status == new_status:
        return _commit(session, lead, None, now)

    entry = Entry(
        lead_id=lead.id,
        kind=EntryKind.STATUS_CHANGED,
        body=f"Status changed from {STATUS_LABELS[lead.status]} to {STATUS_LABELS[new_status]}",
        created_at=now,
    )
    # Non-destructive by design (PLAN.md §4E): the follow-up is left untouched.
    lead.status = new_status
    lead.updated_at = now
    session.add(entry)
    return _commit(session, lead, entry, now)


def add_discussion(
    session: Session, clock: Clock, lead_id: int, data: DiscussionCreate
) -> MutationOut:
    now = _begin_write(session, clock)
    lead = _get_lead(session, lead_id)
    follow_up = data.follow_up_at.astimezone(UTC) if data.follow_up_at else None
    if follow_up is not None and follow_up <= now:
        raise field_error("follow_up_at", "Follow-up must be in the future.")

    entry = Entry(
        lead_id=lead.id, kind=EntryKind.NOTE, body=data.note, follow_up_at=follow_up, created_at=now
    )
    if follow_up is not None:
        lead.next_follow_up_at = follow_up
    lead.updated_at = now
    session.add(entry)
    return _commit(session, lead, entry, now)


def clear_follow_up(session: Session, clock: Clock, lead_id: int) -> MutationOut:
    now = _begin_write(session, clock)
    lead = _get_lead(session, lead_id)
    if lead.next_follow_up_at is None:
        return _commit(session, lead, None, now)

    entry = Entry(
        lead_id=lead.id,
        kind=EntryKind.FOLLOW_UP_CLEARED,
        body="Follow-up marked done",
        follow_up_at=lead.next_follow_up_at,
        created_at=now,
    )
    lead.next_follow_up_at = None
    lead.updated_at = now
    session.add(entry)
    return _commit(session, lead, entry, now)


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def update_details(
    session: Session, clock: Clock, lead_id: int, data: LeadDetailsUpdate
) -> MutationOut:
    now = _begin_write(session, clock)
    lead = _get_lead(session, lead_id)
    changed = []
    for field in ("name", "company", "phone"):
        if field in data.model_fields_set and getattr(lead, field) != getattr(data, field):
            setattr(lead, field, getattr(data, field))
            changed.append(field)
    if not changed:
        return _commit(session, lead, None, now)

    lead.updated_at = now
    entry = Entry(
        lead_id=lead.id,
        kind=EntryKind.DETAILS_UPDATED,
        body=f"Updated {_join(changed)}",
        created_at=now,
    )
    session.add(entry)
    return _commit(session, lead, entry, now)


def set_follow_up(session: Session, clock: Clock, lead_id: int, data: FollowUpSet) -> MutationOut:
    """Set or move the follow-up without writing a discussion note."""
    now = _begin_write(session, clock)
    lead = _get_lead(session, lead_id)
    follow_up = data.follow_up_at.astimezone(UTC)
    if follow_up <= now:
        raise field_error("follow_up_at", "Follow-up must be in the future.")
    if lead.next_follow_up_at == follow_up:
        return _commit(session, lead, None, now)

    entry = Entry(
        lead_id=lead.id,
        kind=EntryKind.FOLLOW_UP_SET,
        body="Follow-up rescheduled" if lead.next_follow_up_at else "Follow-up set",
        follow_up_at=follow_up,
        created_at=now,
    )
    lead.next_follow_up_at = follow_up
    lead.updated_at = now
    session.add(entry)
    return _commit(session, lead, entry, now)
