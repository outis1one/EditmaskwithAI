from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.config import settings
from app.database import init_db
from app.routers import projects, edits, images, patches, generate


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup"""
    init_db()
    yield


app = FastAPI(
    title="AI Photo Edit API",
    description="API for AI-powered photo editing with mask-scoped regeneration",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(projects.router)
app.include_router(edits.router)
app.include_router(images.router)
app.include_router(patches.router)
app.include_router(generate.router)


@app.get("/")
def root():
    """API root endpoint"""
    return {
        "name": "AI Photo Edit API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
def health():
    """Health check endpoint"""
    return {"status": "healthy"}
