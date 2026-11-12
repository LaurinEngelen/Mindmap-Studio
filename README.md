# 🧠 Mindmap Studio

> **Moderne, hochperformante Multi-Projekt Mindmap- & Recherche-Plattform**  
> Konzipiert für interdisziplinäre Teams zur Strukturierung von Forschungsfeldern, Signal-Pipelines, Literatur-Zusammenfassungen und Aufgaben.

---

## 🌟 Features & Highlights

- **Multi-Projekt Management:**
  - Übersichtliches Dashboard auf der Startseite zur Verwaltung beliebig vieler unabhängiger Projekte.
  - Live-Suche, Projekt-Karten mit Farbkodierung, Icon-Auswahl, Knoten- und Aufgaben-Zähler.
  - JSON-Export und Import für nahtlosen Projekt-Transfer.

- **Hochperformante Mindmap (Canvas & SVG):**
  - Stufenloses Zoomen (Mausrad) und Panning (Canvas-Drag).
  - Dynamische kubische Bezier-Verbindungskurven zwischen Knoten.
  - **Delta-Updates:** Drag & Drop sendet lediglich winzige `PATCH /position` Requests (< 50 Bytes) direkt in SQLite in unter 1 ms, anstatt ganze Megabyte-Dateien neu zu schreiben.
  - Integrierter Auto-Arrange Algorithmus für symmetrische Baumstrukturen (Links-/Rechts-Verzweigung).
  - Detail-Modal zur Bearbeitung von Notizen, Bullet-Points, Literaturhinweisen und Team-Zuweisung.

- **Echtzeit-Kollaboration via WebSockets:**
  - Projekt-spezifische WebSocket-Räume (`/ws/{project_id}`).
  - Delta-Broadcasts bei Knoten-Verschiebungen, Status-Änderungen und Aufgaben-Updates ohne Seiten-Reload.

- **Recherche & Dokumenten-Split-View:**
  - Integrierter PDF-Viewer (Inline-Rendering im Browser).
  - Markdown-Viewer mit `marked.js` Syntax-Highlighting und ansprechender Typografie.
  - Drag-and-Drop Datei-Upload mit konfigurierbarem Größenlimit (Standard: 25 MB).
  - Snapshot-Backups pro Projekt auf Knopfdruck oder automatisch bei Modifikationen.

- **Team & Aufgaben (Tasks):**
  - Farbcodierte Teammitglieder mit Initialen-Avatar-Chips.
  - Aufgaben-Sidebar mit Filterung nach Zuständigkeit und Schnell-Checkboxen.

- **Modernste Speicher-Architektur:**
  - **Keine monolithische `data.json` mehr!**
  - SQLite im **WAL-Modus** (`Write-Ahead Logging`) mit Foreign-Key-Kaskadierung für atomare, ausfallsichere Transaktionen.
  - Projekt-isolierte Dateiverzeichnisse (`data/projects/{project_id}/uploads/`).

---

## 🏛️ Architektur-Übersicht

```
Mindmap-Studio/
├── backend/
│   ├── main.py              # FastAPI Application & WebSocket Router
│   ├── config.py            # Zentrale Konfiguration (Auth, Pfade, Limits)
│   ├── database.py          # SQLite Schema, WAL-Modus, Baum-Konstruktor
│   ├── auth.py              # Token-Generierung, Rate-Limiting & Security
│   ├── ws_manager.py        # WebSocket Connection-Manager mit Projekt-Räumen
│   └── routers/
│       ├── projects.py      # Projekt-Dashboard, Export & Import
│       ├── mindmap.py       # Knoten-CRUD, Delta-Positionen, Auto-Layout
│       ├── tasks_team.py    # Teammitglieder & Aufgaben
│       └── documents.py     # Dokumenten-Upload, Streaming & Snapshots
├── static/
│   ├── index.html           # HTML5 Shell mit Tailwind CSS & Modals
│   ├── css/
│   │   └── app.css          # Glassmorphism, Canvas-Grid, Custom Styles
│   └── js/
│       ├── app.js           # SPA-Orchestrator, Routing & UI-State
│       ├── api.js           # Fetch-Wrapper mit Auth-Headers & Toasts
│       ├── ws.js            # WebSocket Client mit Auto-Reconnect
│       ├── dashboard.js     # Startseiten-Logik & Suchfilter
│       ├── mindmap.js       # Canvas Pan/Zoom, Bezier-Curves & Drag-and-Drop
│       ├── tasks.js         # Aufgaben-Liste & Filter
│       ├── team.js          # Teammitglieder-Management & Color-Picker
│       └── documents.js     # Dokumenten-Split-View & Markdown-Renderer
├── data/
│   ├── studio.db            # SQLite WAL Datenbank
│   └── projects/
│       └── {project_id}/
│           ├── uploads/     # Projekt-eigene PDFs, Markdown, Dokumente
│           └── backups/     # Automatische & manuelle JSON-Snapshots
├── scripts/
│   └── migrate_legacy_project.py # Migrations-Tool für v2.2 Projekte
├── Dockerfile               # Unprivilegierter Alpine Container
├── docker-compose.yml       # Production Setup mit Security Flags
└── requirements.txt         # Minimale, blitzschnelle Python Dependencies
```

---

## 🚀 Schnellstart (Lokal)

### Voraussetzungen
- Python 3.10+ (oder [uv](https://github.com/astral-sh/uv))

### Installation & Start
```bash
# 1. In das Projektverzeichnis wechseln
cd Mindmap-Studio

# 2. Abhängigkeiten installieren
pip install -r requirements.txt
# oder mit uv:
uv pip install -r requirements.txt

# 3. Server starten
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload
```

Öffne anschließend im Browser: **`http://localhost:8080`**

---

## 🐳 Deployment mit Docker & Docker Compose

Die Anwendung ist ab Werk für den sicheren Server-Betrieb gehärtet:
- **Unprivilegierter Container:** Läuft unter dem User `appuser:appgroup` (UID 1000).
- **No-New-Privileges:** Verhindert Privilege-Escalation im Linux-Kernel.
- **Passwortschutz:** HMAC-basierte Session-Authentifizierung mit Brute-Force-Sperre (5 Fehlversuche = 10 Minuten IP-Bann).
- **Healthcheck:** Automatisierte Überprüfung des `/api/health` Endpunkts.

### Start per Docker Compose
```bash
docker compose up -d --build
```

Container-Logs ansehen:
```bash
docker compose logs -f mindmap-studio
```

Container stoppen:
```bash
docker compose down
```

---

## 🔒 Konfiguration (.env / Umgebungsvariablen)

In `docker-compose.yml` oder einer `.env`-Datei können folgende Parameter angepasst werden:

| Variable | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| `AUTH_ENABLED` | `true` | Schaltet den zentralen Passwortschutz ein/aus |
| `APP_PASSWORD` | `studio-team-2026!` | Das zentrale Zugriffspasswort |
| `SESSION_SECRET`| `mindmap-studio-secret` | Salt für sichere HMAC-SHA256 Token |
| `MAX_UPLOAD_MB` | `25` | Maximale Dateigröße für Uploads in Megabyte |
| `PORT` | `8080` | Interner Server-Port |

---

## 🔄 Migration alter Projekte

Um bestehende Projekte aus dem Vorgänger-System (z. B. `server/data.json` und zugehörige PDFs) zu importieren:

```bash
python scripts/migrate_legacy_project.py
```

Das Skript:
1. Liest alle Knoten (inkl. Left- & Right-Branches), Teammitglieder und Aufgaben ein.
2. Berechnet automatisch saubere 2D-Startkoordinaten ohne Überlappungen.
3. Kopiert alle Forschungs-Papers und Zusammenfassungen isoliert in den Upload-Ordner des Projekts.
4. Erzeugt direkt einen initialen Backup-Snapshot.

---

## 🧪 Tests ausführen

Das Projekt verfügt über eine vollständige Unittest- und API-Integrations-Testsuite:

```bash
python -m unittest discover -s tests -v
```
