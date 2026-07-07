def official_single_conversation() -> dict:
    return {
        "id": "official-conversation-id",
        "title": "Official Sample",
        "create_time": 1710000000.0,
        "update_time": 1710000300.0,
        "current_node": "assistant-1",
        "mapping": {
            "root": {
                "id": "root",
                "message": None,
                "parent": None,
                "children": ["user-1"],
            },
            "user-1": {
                "id": "user-1",
                "message": {
                    "id": "message-user-1",
                    "author": {"role": "user"},
                    "create_time": 1710000001.0,
                    "content": {"content_type": "text", "parts": ["你好"]},
                    "metadata": {},
                },
                "parent": "root",
                "children": ["assistant-1", "assistant-alt"],
            },
            "assistant-1": {
                "id": "assistant-1",
                "message": {
                    "id": "message-assistant-1",
                    "author": {"role": "assistant"},
                    "create_time": 1710000002.0,
                    "content": {"content_type": "text", "parts": ["你好，有什么可以帮你？"]},
                    "metadata": {"model_slug": "gpt-test"},
                },
                "parent": "user-1",
                "children": [],
            },
            "assistant-alt": {
                "id": "assistant-alt",
                "message": {
                    "id": "message-assistant-alt",
                    "author": {"role": "assistant"},
                    "create_time": 1710000003.0,
                    "content": {"content_type": "text", "parts": ["备用回答"]},
                    "metadata": {"model_slug": "gpt-test"},
                },
                "parent": "user-1",
                "children": [],
            },
        },
    }
