from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.clock import Clock, get_clock
from app.db import get_session
from app.models import LeadStatus
from app.schemas import (
    DiscussionCreate,
    EntryOut,
    LeadCreate,
    LeadListOut,
    LeadOut,
    LeadStatusUpdate,
    MutationOut,
)
from app.services import leads as service

router = APIRouter(prefix="/leads", tags=["leads"])

SessionDep = Annotated[Session, Depends(get_session)]
ClockDep = Annotated[Clock, Depends(get_clock)]


@router.get("", response_model=LeadListOut)
def list_leads(
    session: SessionDep,
    clock: ClockDep,
    status_filter: Annotated[LeadStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    tz: Annotated[str, Query(min_length=1, max_length=64)] = "UTC",
) -> LeadListOut:
    return service.list_leads(session, clock(), tz, status_filter, q)


@router.post("", response_model=MutationOut, status_code=status.HTTP_201_CREATED)
def create_lead(payload: LeadCreate, session: SessionDep, clock: ClockDep) -> MutationOut:
    return service.create_lead(session, clock, payload)


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: int, session: SessionDep, clock: ClockDep) -> LeadOut:
    return service.get_lead(session, clock(), lead_id)


@router.patch("/{lead_id}", response_model=MutationOut)
def update_status(
    lead_id: int, payload: LeadStatusUpdate, session: SessionDep, clock: ClockDep
) -> MutationOut:
    return service.update_status(session, clock, lead_id, payload.status)


@router.get("/{lead_id}/timeline", response_model=list[EntryOut])
def get_timeline(lead_id: int, session: SessionDep) -> list[EntryOut]:
    return service.get_timeline(session, lead_id)


@router.post(
    "/{lead_id}/discussions", response_model=MutationOut, status_code=status.HTTP_201_CREATED
)
def add_discussion(
    lead_id: int, payload: DiscussionCreate, session: SessionDep, clock: ClockDep
) -> MutationOut:
    return service.add_discussion(session, clock, lead_id, payload)


@router.delete("/{lead_id}/follow-up", response_model=MutationOut)
def clear_follow_up(lead_id: int, session: SessionDep, clock: ClockDep) -> MutationOut:
    return service.clear_follow_up(session, clock, lead_id)
