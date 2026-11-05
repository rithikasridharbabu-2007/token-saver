import os

def load_settings():
    return {
        "port": int(os.getenv("PORT", "5000")),
        "log_level": os.getenv("LOG_LEVEL", "info"),
    }
