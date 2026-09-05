from __future__ import annotations

import os

import uvicorn

from google_adk_agent.runtime import install_provider_secret


def main() -> None:
    install_provider_secret(os.environ)
    uvicorn.run(
        "google_adk_agent.app:app",
        host="0.0.0.0",
        port=8000,
        workers=1,
    )


if __name__ == "__main__":
    main()
