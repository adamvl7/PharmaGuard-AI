from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class DrugLabel(Base):
    __tablename__ = "drug_labels"

    id = Column(Integer, primary_key=True, index=True)

    # What user searched
    input_name = Column(String(200), nullable=False, index=True)

    # openFDA metadata
    set_id = Column(String(64), nullable=True, index=True)
    effective_time = Column(String(32), nullable=True)

    # Store label sections (text)
    indications_and_usage = Column(Text, nullable=True)
    contraindications = Column(Text, nullable=True)
    warnings = Column(Text, nullable=True)
    warnings_and_cautions = Column(Text, nullable=True)
    drug_interactions = Column(Text, nullable=True)
    adverse_reactions = Column(Text, nullable=True)
    dosage_and_administration = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class DrugLabelChunk(Base):
    __tablename__ = "drug_label_chunks"

    id = Column(Integer, primary_key=True, index=True)

    label_id = Column(Integer, ForeignKey("drug_labels.id"), nullable=False, index=True)

    section = Column(String(100), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)

    text = Column(Text, nullable=False)

    # We'll store embeddings later (pgvector). For now, keep it as text.
    embedding = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
