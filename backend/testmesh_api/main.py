from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.api_automation import router as api_automation_router

app = FastAPI(title="TestMesh API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type"],
)
app.include_router(api_automation_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "backend": "FastAPI", "api_engine": "testmesh-api/v1"}


