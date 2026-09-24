"""PyInstaller entrypoint for the local XK Reader API."""

from app.main import app

__all__ = ["app"]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
