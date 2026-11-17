import asyncio
import sys

import uvicorn


def selector_loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop()


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run(
        "testmesh_api.main:app", host="127.0.0.1", port=8000,
        loop="testmesh_api.run:selector_loop_factory" if sys.platform == "win32" else "asyncio",
    )


if __name__ == "__main__":
    main()
