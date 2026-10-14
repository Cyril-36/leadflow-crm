from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.db import Base, make_engine, make_session_factory
from app.errors import install_error_handlers
from app.routers import leads

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    """App factory. Run with: uvicorn app.main:create_app --factory"""
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    app = FastAPI(title="LeadFlow API", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = make_session_factory(engine)
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    api = APIRouter(prefix=API_PREFIX)

    @api.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api.include_router(leads.router)
    app.include_router(api)
    return app
