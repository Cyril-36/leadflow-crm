from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UTCDateTime(TypeDecorator[datetime]):
    """Stores aware datetimes as naive UTC; returns aware UTC. Naive input is a bug."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("naive datetime passed to a UTCDateTime column")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        return None if value is None else value.replace(tzinfo=UTC)


class LeadStatus(StrEnum):
    NEW = "new"
    CONTACTED = "contacted"
    QUALIFIED = "qualified"
    PROPOSAL_SENT = "proposal_sent"
    WON = "won"
    LOST = "lost"


STATUS_LABELS: dict[LeadStatus, str] = {
    LeadStatus.NEW: "New",
    LeadStatus.CONTACTED: "Contacted",
    LeadStatus.QUALIFIED: "Qualified",
    LeadStatus.PROPOSAL_SENT: "Proposal Sent",
    LeadStatus.WON: "Won",
    LeadStatus.LOST: "Lost",
}


class EntryKind(StrEnum):
    NOTE = "note"
    LEAD_CREATED = "lead_created"
    STATUS_CHANGED = "status_changed"
    FOLLOW_UP_CLEARED = "follow_up_cleared"


def _str_enum(enum_cls: type[StrEnum]) -> Enum:
    return Enum(
        enum_cls,
        native_enum=False,
        length=20,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    company: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[LeadStatus] = mapped_column(_str_enum(LeadStatus), default=LeadStatus.NEW)
    next_follow_up_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Entry(Base):
    """One timeline item: a discussion note or a system event."""

    __tablename__ = "entries"
    __table_args__ = (
        Index("ix_entries_lead_timeline", "lead_id", "created_at", "id"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    kind: Mapped[EntryKind] = mapped_column(_str_enum(EntryKind))
    body: Mapped[str] = mapped_column(Text)
    # For notes: the follow-up the note set. For follow_up_cleared: the follow-up it cleared.
    follow_up_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
