from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.imports import router as imports_router
from app.api.routes.conversations import router as conversations_router
from app.api.routes.messages import router as messages_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="chat-reader API",
    version="0.0.0",
    description="Stage 00 foundation API for chat-reader.",
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
app.include_router(messages_router)
