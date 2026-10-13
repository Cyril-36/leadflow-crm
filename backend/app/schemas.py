import re
from datetime import datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.models import EntryKind, LeadStatus

PHONE_RE = re.compile(r"^[0-9+().\s-]{3,30}$")


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LeadCreate(_Input):
    name: str = Field(max_length=120)
    company: str | None = Field(default=None, max_length=120)
    phone: str | None = None

    @field_validator("company", "phone", mode="before")
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("name")
    @classmethod
    def _name_required(cls, value: str) -> str:
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, value: str | None) -> str | None:
        if value is not None and not PHONE_RE.fullmatch(value):
            raise ValueError("Phone can contain only digits, spaces and + ( ) - . (3-30 chars).")
        return value


class LeadStatusUpdate(_Input):
    status: LeadStatus


class DiscussionCreate(_Input):
    note: str = Field(max_length=2000)
    follow_up_at: AwareDatetime | None = None

    @field_validator("note")
    @classmethod
    def _note_required(cls, value: str) -> str:
        if not value:
            raise ValueError("Note can't be empty.")
        return value


class LastNote(BaseModel):
    body: str
    at: datetime


class LeadOut(BaseModel):
    id: int
    name: str
    company: str | None
    phone: str | None
    status: LeadStatus
    next_follow_up_at: datetime | None
    follow_up_overdue: bool
    last_note: LastNote | None
    created_at: datetime
    updated_at: datetime


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: EntryKind
    body: str
    follow_up_at: datetime | None
    created_at: datetime


class LeadListOut(BaseModel):
    pinned: list[LeadOut]
    leads: list[LeadOut]


class MutationOut(BaseModel):
    lead: LeadOut
    entry: EntryOut | None
