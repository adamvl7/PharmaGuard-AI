from fastapi import FastAPI, Query, HTTPException, Depends
import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import datetime

from db import engine, SessionLocal
from models import DrugLabel, DrugLabelChunk
from fastapi.middleware.cors import CORSMiddleware


import os
import re
import json
import math
from sentence_transformers import SentenceTransformer

app = FastAPI(title="PharmaGuard API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

embedder = SentenceTransformer("all-MiniLM-L6-v2")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def chunk_text(text: str, max_chars: int = 1000, overlap_sentences: int = 1):
    if not text:
        return []

    text = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r'(?<=[.!?])\s+', text)

    chunks = []
    cur = []
    cur_len = 0

    for s in sentences:
        if not s:
            continue
        add_len = len(s) + (1 if cur else 0)

        if cur_len + add_len <= max_chars:
            cur.append(s)
            cur_len += add_len
        else:
            # flush
            if cur:
                chunks.append(" ".join(cur).strip())

            # overlap last N sentences to preserve context
            cur = cur[-overlap_sentences:] if overlap_sentences > 0 else []
            cur_len = len(" ".join(cur))

            cur.append(s)
            cur_len = len(" ".join(cur))

    if cur:
        chunks.append(" ".join(cur).strip())

    return chunks


def tokenize(q: str):
    q = q.lower()
    q = re.sub(r"[^a-z0-9\s\-]", " ", q)
    return [t for t in q.split() if len(t) >= 3]


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors = embedder.encode(texts, normalize_embeddings=True)
    return [v.tolist() for v in vectors]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))  # normalized vectors

def retrieve_chunks(db: Session, label_id: int, question: str, limit: int = 6):
    tokens = tokenize(question)
    if not tokens:
        return []

    # simple scoring: count how many tokens appear in chunk text
    rows = (
        db.query(DrugLabelChunk)
        .filter(DrugLabelChunk.label_id == label_id)
        .all()
    )

    scored = []
    for r in rows:
        text_lower = (r.text or "").lower()
        score = sum(1 for t in tokens if t in text_lower)
        if score > 0:
            scored.append((score, r))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:limit]]

def retrieve_semantic(db: Session, label_id: int, question: str, limit: int = 6):
    q = embed_texts([question])[0]
    rows = db.query(DrugLabelChunk).filter(DrugLabelChunk.label_id == label_id).all()

    scored = []
    for r in rows:
        if not r.embedding:
            continue
        v = json.loads(r.embedding)
        scored.append((dot(q, v), r))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:limit]]


def best_sentence(text: str, keywords: list[str], max_len: int = 240) -> str:
    if not text:
        return ""

    # Split into sentence-ish chunks
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())

    # Pick the first sentence that contains a keyword
    for s in sentences:
        s_low = s.lower()
        if any(k in s_low for k in keywords) and len(s.strip()) > 20:
            return s.strip()[:max_len]

    # Fallback: first "reasonable" sentence
    for s in sentences:
        if len(s.strip()) > 40:
            return s.strip()[:max_len]

    # Final fallback
    return text.strip()[:max_len]


@app.get("/health")
def health():
    return {"status": "ok", "service": "pharmaguard-api"}


@app.get("/db-check")
def db_check():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1")).scalar()
    return {"db": "ok", "result": result}


@app.get("/debug-path")
def debug_path():
    return {"cwd": os.getcwd(), "file": __file__}


@app.get("/rxnorm/normalize")
async def rxnorm_normalize(name: str = Query(min_length=1, max_length=200)):
    url = "https://rxnav.nlm.nih.gov/REST/approximateTerm.json"
    params = {"term": name, "maxEntries": 5}

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    candidates = data.get("approximateGroup", {}).get("candidate", [])
    results = [
        {"rxcui": c.get("rxcui"), "score": c.get("score"), "rank": c.get("rank")}
        for c in candidates
    ]

    return {"input": name, "matches": results}


@app.get("/fda/label")
async def fda_label(drug: str = Query(min_length=1, max_length=200)):
    url = "https://api.fda.gov/drug/label.json"
    params = {
        "search": f'openfda.generic_name:"{drug}" OR openfda.brand_name:"{drug}"',
        "limit": 1
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params)

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="No FDA label found for this drug name.")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="openFDA request failed.")

    data = resp.json()
    results = data.get("results", [])
    if not results:
        raise HTTPException(status_code=404, detail="No FDA label found for this drug name.")

    label = results[0]

    def get_first(field: str):
        value = label.get(field)
        if isinstance(value, list) and value:
            return value[0]
        if isinstance(value, str):
            return value
        return None

    return {
        "input": drug,
        "source": "openFDA",
        "set_id": label.get("set_id"),
        "effective_time": label.get("effective_time"),
        "openfda": label.get("openfda", {}),
        "sections": {
            "indications_and_usage": get_first("indications_and_usage"),
            "contraindications": get_first("contraindications"),
            "warnings": get_first("warnings"),
            "warnings_and_cautions": get_first("warnings_and_cautions"),
            "drug_interactions": get_first("drug_interactions"),
            "adverse_reactions": get_first("adverse_reactions"),
            "dosage_and_administration": get_first("dosage_and_administration"),
        }
    }


@app.post("/ingest/fda-label")
async def ingest_fda_label(
    drug: str = Query(min_length=1, max_length=200),
    db: Session = Depends(get_db)
):
    url = "https://api.fda.gov/drug/label.json"
    params = {
        "search": f'openfda.generic_name:"{drug}" OR openfda.brand_name:"{drug}"',
        "limit": 1
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params)

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="No FDA label found for this drug name.")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="openFDA request failed.")

    data = resp.json()
    results = data.get("results", [])
    if not results:
        raise HTTPException(status_code=404, detail="No FDA label found for this drug name.")

    label = results[0]

    def get_first(field: str):
        value = label.get(field)
        if isinstance(value, list) and value:
            return value[0]
        if isinstance(value, str):
            return value
        return None

    sections = {
        "indications_and_usage": get_first("indications_and_usage"),
        "contraindications": get_first("contraindications"),
        "warnings": get_first("warnings"),
        "warnings_and_cautions": get_first("warnings_and_cautions"),
        "drug_interactions": get_first("drug_interactions"),
        "adverse_reactions": get_first("adverse_reactions"),
        "dosage_and_administration": get_first("dosage_and_administration"),
    }

    row = DrugLabel(
        input_name=drug,
        set_id=label.get("set_id"),
        effective_time=label.get("effective_time"),
        indications_and_usage=sections["indications_and_usage"],
        contraindications=sections["contraindications"],
        warnings=sections["warnings"],
        warnings_and_cautions=sections["warnings_and_cautions"],
        drug_interactions=sections["drug_interactions"],
        adverse_reactions=sections["adverse_reactions"],
        dosage_and_administration=sections["dosage_and_administration"],
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    # Store chunks
    total_chunks = 0
    for section_name, section_text in sections.items():
        for idx, chunk in enumerate(chunk_text(section_text)):
            db.add(DrugLabelChunk(
                label_id=row.id,
                section=section_name,
                chunk_index=idx,
                text=chunk
            ))
            total_chunks += 1

    db.commit()

    # Auto-embed chunks for this label
    rows = db.query(DrugLabelChunk).filter(DrugLabelChunk.label_id == row.id).all()
    vecs = embed_texts([r.text for r in rows])
    for r, v in zip(rows, vecs):
        r.embedding = json.dumps(v)
    db.commit()

    return {
        "status": "stored",
        "id": row.id,
        "input": drug,
        "set_id": row.set_id,
        "chunks_stored": total_chunks
    }


@app.get("/labels")
def get_labels(name: str = Query(min_length=1, max_length=200), db: Session = Depends(get_db)):
    rows = (
        db.query(DrugLabel)
        .filter(DrugLabel.input_name.ilike(f"%{name}%"))
        .order_by(DrugLabel.created_at.desc())
        .limit(5)
        .all()
    )

    return {
        "input": name,
        "count": len(rows),
        "labels": [
            {
                "id": r.id,
                "input_name": r.input_name,
                "set_id": r.set_id,
                "effective_time": r.effective_time,
                "created_at": r.created_at.isoformat(),
                "sections": {
                    "contraindications": r.contraindications,
                    "warnings": r.warnings,
                    "warnings_and_cautions": r.warnings_and_cautions,
                    "drug_interactions": r.drug_interactions,
                }
            }
            for r in rows
        ]
    }


@app.get("/chunks")
def get_chunks(label_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(DrugLabelChunk)
        .filter(DrugLabelChunk.label_id == label_id)
        .order_by(DrugLabelChunk.section.asc(), DrugLabelChunk.chunk_index.asc())
        .limit(50)
        .all()
    )

    return {
        "label_id": label_id,
        "count": len(rows),
        "chunks": [
            {"id": r.id, "section": r.section, "chunk_index": r.chunk_index, "text": r.text[:500]}
            for r in rows
        ]
    }

@app.get("/chunks/{chunk_id}")
def get_chunk(chunk_id: int, db: Session = Depends(get_db)):
    r = db.query(DrugLabelChunk).filter(DrugLabelChunk.id == chunk_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return {
        "id": r.id,
        "label_id": r.label_id,
        "section": r.section,
        "chunk_index": r.chunk_index,
        "text": r.text
    }

@app.post("/embed/label")
def embed_label(label_id: int, db: Session = Depends(get_db)):
    rows = db.query(DrugLabelChunk).filter(DrugLabelChunk.label_id == label_id).all()
    to_embed = [r for r in rows if not r.embedding]
    if not to_embed:
        return {"status": "ok", "embedded": 0}

    vecs = embed_texts([r.text for r in to_embed])
    for r, v in zip(to_embed, vecs):
        r.embedding = json.dumps(v)

    db.commit()
    return {"status": "ok", "embedded": len(to_embed)}

@app.get("/db-tables")
def db_tables():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'")).fetchall()
    return {"tables": [r[0] for r in rows]}

@app.post("/chat")
async def chat(
    label_id: int,
    question: str,
    db: Session = Depends(get_db),
):
    q = question.lower()

    keywords = []
    if "interaction" in q:
        keywords += ["interaction", "interact"]
    if "warning" in q or "risk" in q or "bleeding" in q:
        keywords += ["warning", "bleeding", "risk", "ulcer", "stroke", "heart"]
    if "dose" in q:
        keywords += ["dose", "dosage"]
    if "contra" in q:
        keywords += ["contraindication"]

    if not keywords:
        keywords = ["warning", "interaction", "risk"]

    # Prefer semantic if embeddings exist, fallback to keyword
    sem = retrieve_semantic(db, label_id, question, limit=6)
    if sem:
        matched = sem
    else:
        matched = retrieve_chunks(db, label_id, question, limit=6)

    if not matched:
        return {
            "answer": [
                "I couldn't find relevant FDA label sections for that question.",
                "Try asking about: drug interactions, warnings, contraindications, adverse reactions, or dosage.",
            ],
            "safety_note": "Not medical advice. Confirm with a pharmacist/clinician.",
            "citations": [],
            "evidence": [],
        }

    answer_lines = []
    evidence = []

    for c in matched:
        snippet = best_sentence(c.text, keywords)
        answer_lines.append(f"• {snippet}...")
        evidence.append({
            "chunk_id": c.id,
            "section": c.section,
            "chunk_index": c.chunk_index,
            "preview": c.text[:200] + ("..." if len(c.text) > 200 else ""),
        })

    return {
        "answer": answer_lines,
        "safety_note": "Not medical advice. Confirm with a pharmacist/clinician.",
        "citations": [
            {
                "chunk_id": c["chunk_id"],
                "section": c["section"],
                "chunk_index": c["chunk_index"],
            }
            for c in evidence
        ],
        "evidence": evidence,
    }

@app.post("/chat-by-drug")
async def chat_by_drug(
    drug: str = Query(min_length=1, max_length=200),
    question: str = Query(min_length=1, max_length=2000),
    db: Session = Depends(get_db),
):
    # 1) Find most recent label for this drug (user might type brand/generic variants)
    existing = (
        db.query(DrugLabel)
        .filter(DrugLabel.input_name.ilike(f"%{drug}%"))
        .order_by(DrugLabel.created_at.desc())
        .first()
    )

    # 2) If not found, auto-ingest
    if not existing:
        # reuse your ingest logic directly (call function or inline minimal)
        stored = await ingest_fda_label(drug=drug, db=db)  # calls your POST /ingest logic
        label_id = stored["id"]
    else:
        label_id = existing.id

    # 3) Run your existing chat on that label_id
    result = await chat(label_id=label_id, question=question, db=db)

    # 4) Include label_id for UI display
    if isinstance(result, dict):
        result["label_id"] = label_id
    return result

@app.post("/compare")
def compare(drug_a: str, drug_b: str, db: Session = Depends(get_db)):
    # 1) Find latest stored labels for each drug
    a = (
        db.query(DrugLabel)
        .filter(DrugLabel.input_name.ilike(f"%{drug_a}%"))
        .order_by(DrugLabel.created_at.desc())
        .first()
    )
    b = (
        db.query(DrugLabel)
        .filter(DrugLabel.input_name.ilike(f"%{drug_b}%"))
        .order_by(DrugLabel.created_at.desc())
        .first()
    )

    if not a or not b:
        raise HTTPException(
            status_code=400,
            detail="Both drugs must be ingested first. Use POST /ingest/fda-label for each drug."
        )

    # 2) Ensure embeddings exist (basic check)
    a_chunks = db.query(DrugLabelChunk).filter(DrugLabelChunk.label_id == a.id).all()
    b_chunks = db.query(DrugLabelChunk).filter(DrugLabelChunk.label_id == b.id).all()

    if any(c.embedding is None for c in a_chunks) or any(c.embedding is None for c in b_chunks):
        return {
            "status": "needs_embeddings",
            "message": "Run POST /embed/label for both label_id values first.",
            "label_ids": {"drug_a": a.id, "drug_b": b.id}
        }

    # 3) Ask semantic search questions against each label
    q1 = f"Does the label mention interactions with {drug_b}?"
    q2 = f"Does the label mention interactions with {drug_a}?"
    q3 = "drug interactions anticoagulants aspirin NSAIDs blood thinners"

    a_top = retrieve_semantic(db, a.id, q1, limit=4) + retrieve_semantic(db, a.id, q3, limit=2)
    b_top = retrieve_semantic(db, b.id, q2, limit=4) + retrieve_semantic(db, b.id, q3, limit=2)

    def pack(rows):
        out = []
        for r in rows[:6]:
            out.append({
                "chunk_id": r.id,
                "section": r.section,
                "chunk_index": r.chunk_index,
                "preview": r.text[:350]
            })
        return out

    return {
        "status": "ok",
        "drug_a": {"name": drug_a, "label_id": a.id},
        "drug_b": {"name": drug_b, "label_id": b.id},
        "summary": [
            "This tool searches FDA label text for interaction-related language.",
            "It may miss cases; labels do not list every interaction.",
            "Not medical advice. Confirm with a pharmacist/clinician."
        ],
        "evidence": {
            "from_drug_a_label": pack(a_top),
            "from_drug_b_label": pack(b_top)
        }
    }
