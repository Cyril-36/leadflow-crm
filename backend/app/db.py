from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

WRITE_OPTION = "leadflow_write"


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> Engine:
    engine = create_engine(database_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _record) -> None:
        # Hand transaction control to SQLAlchemy so the "begin" hook below decides how
        # transactions start (the documented pysqlite recipe).
        dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _begin(connection) -> None:
        # Reads use ordinary deferred transactions, so in WAL mode they never wait for writers.
        # Write transactions (opened via begin_write) take the write lock up front, so writes are
        # serialized and never fail mid-transaction on a stale read snapshot.
        mode = "IMMEDIATE" if connection.get_execution_options().get(WRITE_OPTION) else "DEFERRED"
        connection.exec_driver_sql(f"BEGIN {mode}")

    return engine


def begin_write(session: Session) -> None:
    """Start a write transaction on `session`, holding SQLite's write lock until commit."""
    if session.in_transaction():
        raise RuntimeError("begin_write must open the session's transaction")
    session.connection(execution_options={WRITE_OPTION: True})


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session
