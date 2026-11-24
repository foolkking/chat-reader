"""Readable synthetic catalog for real panel layout captures; disposable beta lab only."""
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from app.core.database import SessionLocal
from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.recent_item import RecentItem
from app.models.user import User

assert os.environ["APP_ENV"] == "test" and os.environ["PUBLIC_WEB_BASE_URL"] == os.environ["SYNTHETIC_ORIGIN"] in {"http://127.0.0.1:18383","http://127.0.0.1:18483"}
pid, lang = uuid.UUID(sys.argv[1]), sys.argv[2]
now = datetime.now(timezone.utc)
words = ([
    "从浮标到岸线：潮位观测方法", "声学剖面的校正笔记", "手稿中的月相与潮汐表",
    "浮标数据质量复核：跨时区的采样、时间校正与复测记录", "整理海岸观察日志",
] if lang == "zh" else [
    "From buoy to shore: tide observations", "Calibrating the acoustic profile", "Lunar phases in the field journal",
    "Reviewing offshore samples: time zones, calibration and repeat measurements across stations", "Notes from the coastal survey",
])
with SessionLocal() as db:
    project=db.get(Project,pid)
    assert project.name.startswith("Tide project ") and db.scalar(select(User.normalized_email).where(
        User.id==project.owner_user_id))=="browser-beta@example.test"
    for i,title in enumerate(words):
        at=now-timedelta(days=i)
        cv=Conversation(title=title,display_title=title,owner_user_id=project.owner_user_id,source_type="synthetic",
                        source_profile="synthetic",parser_version="layout-fixture",updated_at=at,is_global_pinned=i==1)
        db.add(cv);db.flush()
        db.add(ProjectConversation(conversation_id=cv.id,project_id=pid,is_pinned=i==1))
        db.add(RecentItem(conversation_id=cv.id,last_opened_at=at))
        for j in range([3,0,1,0,0][i]):
            db.add(Attachment(conversation_id=cv.id,display_name=f"synthetic-{j}",original_filename=f"synthetic-{j}"))
    db.commit()
print(json.dumps({"conversations":5,"file_metadata":4}))
