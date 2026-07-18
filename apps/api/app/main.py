from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.imports import router as imports_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.exports import router as exports_router
from app.api.routes.messages import router as messages_router
from app.api.routes.projects import router as projects_router
from app.api.routes.preferences import router as preferences_router
from app.api.routes.reading import router as reading_router
from app.api.routes.search import router as search_router
from app.api.routes.shares import router as shares_router
from app.api.routes.toc import router as toc_router
from app.api.routes.tasks import router as tasks_router
from app.api.routes.archive_exports import router as archive_exports_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="chat-reader API",
    version="0.12.0",
    description="Canonical archive, search, editing, project, share, and export API for Chat Reader.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(imports_router)
app.include_router(conversations_router)
app.include_router(exports_router)
app.include_router(messages_router)
app.include_router(projects_router)
app.include_router(preferences_router)
app.include_router(reading_router)
app.include_router(search_router)
app.include_router(shares_router)
app.include_router(toc_router)
app.include_router(tasks_router)
app.include_router(archive_exports_router)
