import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("leadflow")

_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}
_PARAM_SOURCES = {"body", "query", "path", "header", "cookie"}


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def lead_not_found(lead_id: int) -> AppError:
    return AppError(404, "lead_not_found", f"Lead {lead_id} was not found.")


def field_error(field: str, message: str) -> AppError:
    return AppError(422, "validation_error", message, [{"field": field, "message": message}])


def _envelope(
    status_code: int, code: str, message: str, details: list[dict[str, str]] | None = None
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return JSONResponse(status_code=status_code, content={"error": error})


def _field_name(loc: tuple[Any, ...]) -> str:
    parts = [str(part) for part in loc if part not in _PARAM_SOURCES]
    return ".".join(parts) or "request"


def _error_message(err: dict[str, Any]) -> str:
    # Our own validators raise ValueError; show their text without Pydantic's prefix.
    ctx_error = (err.get("ctx") or {}).get("error")
    if err.get("type") == "value_error" and ctx_error is not None:
        return str(ctx_error)
    return str(err.get("msg", "Invalid value."))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_request: Request, exc: AppError) -> JSONResponse:
        return _envelope(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _envelope(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": _field_name(tuple(err.get("loc", ()))), "message": _error_message(err)}
            for err in exc.errors()
        ]
        message = details[0]["message"] if len(details) == 1 else "Some fields are invalid."
        return _envelope(422, "validation_error", message, details)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _envelope(500, "internal_error", "Something went wrong on the server.")
