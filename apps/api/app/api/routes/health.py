from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    stage: str


def health_payload() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="chat-reader-api",
        stage="stage-00-foundation",
    )


@router.get("/health", response_model=HealthResponse)
def root_health() -> HealthResponse:
    return health_payload()


@router.get("/api/health", response_model=HealthResponse)
def api_health() -> HealthResponse:
    return health_payload()
