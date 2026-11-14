"""Lightweight editing validation errors; the editor service reexports them."""
from http import HTTPStatus


class MessageEditError(ValueError):
    def __init__(
        self,
        message: str,
        status_code: int = HTTPStatus.BAD_REQUEST,
        *,
        code: str | None = None,
        line_number: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.line_number = line_number

    @property
    def detail(self) -> str | dict[str, str | int]:
        if self.code is None:
            return str(self)
        detail: dict[str, str | int] = {"code": self.code, "message": str(self)}
        if self.line_number is not None:
            detail["line_number"] = self.line_number
        return detail
