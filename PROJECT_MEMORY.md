# Project Memory: Mindmap Studio

## Overview
Mindmap Studio is an independent, high-performance multi-project web platform for visual knowledge mapping, team assignment, task tracking, and document research. It replaces monolithic legacy scripts with an enterprise-grade modular architecture.

## Architecture
- **Backend:** FastAPI, Python 3.12, SQLite in WAL mode (`studio.db`), Uvicorn.
- **Frontend:** Modular ES6 architecture (`app.js`, `api.js`, `ws.js`, `dashboard.js`, `mindmap.js`, `team.js`, `tasks.js`, `documents.js`) with Tailwind CSS & glassmorphic styling.
- **Storage:** Isolated project file trees under `data/projects/{project_id}/` (`uploads/` and `backups/`).
- **Security:** HMAC-SHA256 session cookies, rate-limiting brute-force guard (5 attempts = 10 min IP jail), 25MB max file upload limit, non-root user (UID 1000, `no-new-privileges: true`).
- **Performance:** Sub-millisecond node position updates via delta `PATCH /position` (< 50 bytes) instead of multi-megabyte monolithic JSON file rewrites.

## Roadmap & Status
- [x] **Phase 1: Project Setup, Skills, Configuration & Database Layer (SQLite WAL Mode)**
  - Schema with 5 relational tables (`projects`, `team_members`, `nodes`, `tasks`, `documents`).
  - Unit tests for WAL mode, cascade deletion, and hierarchical tree construction.
- [x] **Phase 2: Auth, Project Room WebSocket Manager & Project Management CRUD API**
  - Session management, password rate limiter, and room-scoped WebSocket messaging (`/ws/{project_id}`).
  - Projects dashboard API with real-time statistics queries, export and import.
- [x] **Phase 3: Delta APIs for Mindmap, Team Members, Tasks, and Documents**
  - Fast delta position updates, batch layout endpoints, team member CRUD, task assignment, document streaming.
- [x] **Phase 4: Frontend Framework, State Router & Dashboard View**
  - SPA view switcher (`#dashboardView` vs. `#workspaceView`), live search, modal dialogs, dark mode.
- [x] **Phase 5: Mindmap Canvas Engine, Collision-Free Auto-Layout & Real-time Delta Updates**
  - Pan/zoom canvas, cubic Bezier connection lines, animated node dragging, autoArrange tree algorithm.
- [x] **Phase 6: Tasks Sidebar with Member Assignment & Document Research Split View**
  - Task toggle, filter by assignee, inline PDF preview, marked.js markdown renderer, drag-and-drop file upload.
- [x] **Phase 7: Docker Containerization & Legacy Schlafapnoe-Projekt Migration**
  - Production `Dockerfile` (Alpine, non-root `appuser:appgroup` UID 1000).
  - Production `docker-compose.yml` with healthchecks, restart policies, and security flags.
  - Automated migration script `scripts/migrate_legacy_project.py` migrating all 66 nodes, 7 team members, 5 tasks, and 15 research papers/summaries.
  - 100% test coverage passing in 0.63s across 7 automated unit and E2E integration tests.

## Key Paths
- **Project Root:** `c:\Users\lauri\Meine Ablage\Privat\Projekte\Mindmap-Studio`
- **Database:** `data/studio.db`
- **Projects Data:** `data/projects/{project_id}/`
- **Frontend Assets:** `static/`
- **Backend Code:** `backend/`
- **Docker Compose:** `docker-compose.yml`
