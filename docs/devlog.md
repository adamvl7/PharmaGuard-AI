\# PharmaGuard AI – Devlog



\## 2026-01-16

\- Built FastAPI backend for FDA label ingestion (openFDA)

\- Implemented chunking + PostgreSQL storage (SQLAlchemy)

\- Added semantic retrieval (local embeddings) and citation based chat endpoint

\- Added drug–drug comparison endpoint for interaction evidence

## 2026-01-21
- Integrated SentenceTransformers embeddings into backend for semantic search
- Implemented citation-backed FDA-grounded chat flow (no hallucinations)
- Added chunk preview + citation viewer UI in Next.js frontend
- Fixed broken sentence boundaries in answers for cleaner UX
- Wired frontend ↔ backend via CORS and localhost API routing
- Verified full ingestion → chunking → embeddings → chat → citation pipeline
- Added compare-drugs logic to backend (semantic interaction search)
- Refactored main.py for modular retrieval + embedding workflow
- Cleaned up .gitignore and removed tracked pycache artifacts
- Pushed MVP updates to GitHub with structured commit history

