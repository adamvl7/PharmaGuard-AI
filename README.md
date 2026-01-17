# PharmaGuard AI

PharmaGuard AI is a safety-focused AI system that helps users explore **official FDA drug labeling data**
through a **citation-based question-answering interface**.

Unlike generic chatbots, PharmaGuard does **not generate medical advice** or hallucinate answers.
Every response is grounded in **authoritative FDA label text** and clearly cites its sources.

---

## Why PharmaGuard Exists

FDA drug labels contain critical safety information such as:
- contraindications
- warnings and precautions
- drug–drug interactions
- dosage guidance

However, these documents are long, dense, and difficult to query efficiently.

PharmaGuard explores how **retrieval-based AI systems** can improve access to regulatory drug
information while remaining **safe, auditable, and compliance-friendly**.

---

## Key Features

- **FDA Label Ingestion**
  - Fetches official drug labeling data via the openFDA API
  - Stores normalized label data in PostgreSQL

- **Text Chunking & Storage**
  - Splits large FDA label sections into overlapping chunks
  - Preserves section context for traceability

- **Semantic Retrieval (No Paid APIs)**
  - Uses local sentence-transformer embeddings
  - Enables meaning-based search over FDA text
  - Zero cost, fully reproducible

- **Citation-Based Q&A**
  - Answers questions by retrieving relevant FDA label excerpts
  - Each response includes source citations (chunk IDs + sections)

- **Drug–Drug Interaction Comparison**
  - Compares FDA labels for two drugs
  - Surfaces interaction-related language from both labels
  - Designed for evidence review, not diagnosis

---

## Example Use Cases

- Quickly find FDA-listed interactions for a medication
- Review warnings or contraindications before prescribing
- Compare safety language across two drugs
- Demonstrate a healthcare-safe RAG (Retrieval Augmented Generation) system

---

## Tech Stack

- **Backend:** FastAPI (Python)
- **Database:** PostgreSQL + SQLAlchemy
- **AI / NLP:** sentence-transformers (local embeddings)
- **Data Source:** openFDA API
- **Architecture:** Retrieval-based AI (RAG, no hallucination)

---

## System Architecture

openFDA
↓
Label Ingestion API
↓
PostgreSQL (drug_labels)
↓
Chunking (drug_label_chunks)
↓
Local Embeddings
↓
Semantic Retrieval
↓
Citation-Based Responses

---

## Safety & Disclaimer

PharmaGuard AI **does not provide medical advice**.

- All responses are derived from FDA labeling text
- The system may not capture every possible interaction
- Always consult a licensed healthcare professional

This project is intended for **educational and research purposes**.

---

## Current Status

- MVP complete
- Actively developed and improved
- Frontend UI planned
- Additional FDA datasets (adverse events) planned

Progress updates are tracked in `docs/devlog.md`.

---

## License

MIT License

---

## Author

- Adam Le


