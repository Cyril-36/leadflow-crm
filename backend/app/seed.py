"""Demo data: 8 fictional leads with discussions, dates relative to now.

    uv run python -m app.seed             # refuses to touch a database that already has leads
    uv run python -m app.seed --if-empty  # seeds only an empty database, otherwise exits quietly
    uv run python -m app.seed --reset     # wipes the database first

Everything goes through the service layer, so the seed obeys the same rules as the API.
"""

import argparse
import sys
from datetime import datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import Base, make_engine, make_session_factory
from app.models import Lead, LeadStatus
from app.schemas import DiscussionCreate, LeadCreate
from app.services import leads as service

LEAD_COUNT = 8
NOTE_COUNT = 11


def _floor_quarter(t: datetime) -> datetime:
    return t - timedelta(minutes=t.minute % 15, seconds=t.second, microseconds=t.microsecond)


def _ceil_quarter(t: datetime) -> datetime:
    floored = _floor_quarter(t)
    return floored if floored == t else floored + timedelta(minutes=15)


class _Seeder:
    def __init__(self, session: Session, now: datetime) -> None:
        self.session = session
        self.now = now
        self.midnight = datetime.combine(now.date(), time.min, tzinfo=now.tzinfo)

    def day(self, offset: int, hour: int, minute: int = 0) -> datetime:
        """A local wall-clock time `offset` days from today."""
        return datetime.combine(
            self.now.date() + timedelta(days=offset), time(hour, minute), tzinfo=self.now.tzinfo
        )

    def weekday(self, offset: int, hour: int, minute: int = 0) -> datetime:
        """Like day(), but moved forward to Monday if it lands on a weekend."""
        at = self.day(offset, hour, minute)
        while at.weekday() >= 5:
            at += timedelta(days=1)
        return at

    def earlier_today(self) -> datetime:
        """A follow-up that already passed today, in business hours whenever now allows it."""
        candidate = min(
            max(self.day(0, 9), _floor_quarter(self.now - timedelta(hours=2))), self.day(0, 17, 30)
        )
        if candidate < self.now:
            return candidate
        return self.now - min(timedelta(hours=2), (self.now - self.midnight) / 2)

    def later_today(self) -> datetime:
        """A follow-up still ahead today, in business hours whenever now allows it."""
        candidate = min(
            max(self.day(0, 10), _ceil_quarter(self.now + timedelta(hours=2))), self.day(0, 17, 30)
        )
        if candidate > self.now:
            return candidate
        return self.now + min(
            timedelta(hours=3), (self.midnight + timedelta(days=1) - self.now) / 2
        )

    def recent(self) -> datetime:
        """The most recent discussion: this morning in business hours when possible."""
        candidate = max(self.day(0, 9), _floor_quarter(self.now - timedelta(hours=2)))
        if candidate < self.now - timedelta(minutes=25):
            return candidate
        return self.now - min(timedelta(hours=2), (self.now - self.midnight) / 3)

    def lead(self, at: datetime, name: str, company: str | None, phone: str | None) -> int:
        payload = LeadCreate(name=name, company=company, phone=phone)
        return service.create_lead(self.session, lambda: at, payload).lead.id

    def note(
        self, lead_id: int, at: datetime, text: str, follow_up: datetime | None = None
    ) -> None:
        payload = DiscussionCreate(note=text, follow_up_at=follow_up)
        service.add_discussion(self.session, lambda: at, lead_id, payload)

    def status(self, lead_id: int, at: datetime, status: LeadStatus) -> None:
        service.update_status(self.session, lambda: at, lead_id, status)


def seed(session_factory: sessionmaker[Session], now: datetime) -> None:
    """Insert the demo leads. `now` must be timezone-aware; it fixes what "today" means."""
    with session_factory() as session:
        s = _Seeder(session, now)
        # Two follow-ups today, one already passed and one still ahead: business-hour times when
        # the clock allows, otherwise times relative to now so the demo works at any hour.
        earlier_today = s.earlier_today()
        later_today = s.later_today()
        recent = s.recent()

        rohan = s.lead(s.day(-8, 9), "Rohan Mehta", "Tidewater Foods", "555-0101")
        s.note(
            rohan,
            s.day(-1, 17, 10),
            "Left a voicemail. He asked for a callback after their board meeting.",
            earlier_today,
        )
        s.status(rohan, s.day(-1, 17, 11), LeadStatus.CONTACTED)

        ananya = s.lead(s.day(-7, 9, 2), "Ananya Rao", "Kestrel Logistics", "555-0102")
        s.note(
            ananya, s.day(-6, 11, 30), "Intro call. 40 reps tracking leads in shared spreadsheets."
        )
        s.status(ananya, s.day(-6, 11, 40), LeadStatus.QUALIFIED)
        s.note(
            ananya,
            s.day(-2, 16, 5),
            "Call with Ananya and their ops lead. They need bulk import and a weekly digest.",
        )
        s.status(ananya, s.day(-2, 16, 20), LeadStatus.PROPOSAL_SENT)
        s.note(
            ananya,
            recent,
            "Sent revised pricing for 40 seats. She is reviewing it with finance.",
            later_today,
        )

        farah = s.lead(s.day(-5, 11, 50), "Farah Siddiqui", "Lumen Clinics", "555-0103")
        s.note(
            farah, s.day(-5, 12), "First call. Runs 12 clinics; the front desk logs leads on paper."
        )
        s.status(farah, s.day(-3, 14, 2), LeadStatus.QUALIFIED)
        s.note(
            farah,
            s.day(-3, 14),
            "Needs SSO and audit logs before procurement will sign.",
            s.day(-1, 16),
        )

        s.lead(recent - timedelta(minutes=5), "Karthik Nair", "Orchard Lane Realty", None)

        leah = s.lead(s.day(-4, 15), "Leah Fernandes", "Brightwater Advisory", "555-0105")
        s.status(leah, s.day(-3, 10), LeadStatus.CONTACTED)
        s.note(
            leah,
            recent - timedelta(minutes=20),
            "Demo went well. Wants a two-week trial for two advisors.",
            s.weekday(2, 11),
        )
        s.status(leah, recent - timedelta(minutes=19), LeadStatus.QUALIFIED)

        arjun = s.lead(s.day(-2, 10), "Arjun Kapoor", "Halcyon Freight", "555-0106")
        s.note(
            arjun,
            s.day(-2, 11),
            "Intro call done. Send the logistics case study.",
            s.weekday(5, 10),
        )
        s.status(arjun, s.day(-2, 11, 1), LeadStatus.CONTACTED)

        vikram = s.lead(s.day(-24, 14), "Vikram Desai", "Northgate Capital", "555-0107")
        s.note(vikram, s.day(-14, 10), "Shared the proposal for the annual plan.")
        s.status(vikram, s.day(-14, 10, 5), LeadStatus.PROPOSAL_SENT)
        s.note(
            vikram,
            s.day(-7, 15, 20),
            "Signed the annual plan. Onboarding call booked for next week.",
        )
        s.status(vikram, s.day(-7, 15, 30), LeadStatus.WON)

        sofia = s.lead(s.day(-34, 12), "Sofia Thomas", "Cedar & Pine Studio", None)
        s.status(sofia, s.day(-28, 9), LeadStatus.QUALIFIED)
        s.note(
            sofia,
            s.day(-21, 11),
            "Staying with their spreadsheet for now. Check back next quarter.",
        )
        s.status(sofia, s.day(-21, 11, 5), LeadStatus.LOST)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load LeadFlow demo data.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--reset", action="store_true", help="delete all existing data first")
    mode.add_argument(
        "--if-empty", action="store_true", help="seed only an empty database; otherwise do nothing"
    )
    args = parser.parse_args(argv)

    settings = Settings()
    engine = make_engine(settings.database_url)
    if args.reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        existing = session.scalar(select(func.count()).select_from(Lead))
    if existing:
        if args.if_empty:
            print(f"The database already has {existing} leads; leaving it as it is.")
            return 0
        print(f"The database already has {existing} leads. Re-run with --reset to replace them.")
        return 1

    seed(session_factory, datetime.now().astimezone())
    print(
        f"Seeded {LEAD_COUNT} leads and {NOTE_COUNT} discussion notes into {settings.database_url}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
