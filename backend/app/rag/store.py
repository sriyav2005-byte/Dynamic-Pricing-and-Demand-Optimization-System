"""
rag/store.py — knowledge base for the Retail Copilot (retrieval-augmented generation).

Documents (global policy docs in rag/docs/*.md, plus organization documents)
are split into overlapping chunks and embedded. Embedding backends:

    voyage   Voyage AI (voyage-3-lite, 512 dims) when VOYAGE_API_KEY is set
    hashing  local 512-dim hashed word/bigram TF vectors (default; no network,
             deterministic, lexical rather than semantic)

Chunks live in public.knowledge_chunks (real[] embeddings; pgvector column
when the extension exists). Retrieval = cosine similarity over the chunks
visible to the organization (global + own), highest scores first.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import HashingVectorizer
from sqlalchemy import text

from app import db
from app.config import get_settings

log = logging.getLogger("priceiq.rag")
DIM = 512
DOCS_DIR = Path(__file__).parent / "docs"
_hasher = HashingVectorizer(n_features=DIM, ngram_range=(1, 2), alternate_sign=False, norm="l2",
                            stop_words="english", token_pattern=r"(?u)\b[\w₹%]+\b")


def embed(texts: list[str]) -> tuple[np.ndarray, str]:
    key = get_settings().voyage_api_key
    if key:
        try:
            import httpx
            r = httpx.post("https://api.voyageai.com/v1/embeddings", timeout=30,
                           headers={"Authorization": f"Bearer {key}"},
                           json={"input": texts, "model": "voyage-3-lite"})
            r.raise_for_status()
            vecs = np.array([d["embedding"] for d in r.json()["data"]], dtype=np.float32)
            return vecs / np.linalg.norm(vecs, axis=1, keepdims=True), "voyage-3-lite"
        except Exception as exc:
            log.warning("voyage embeddings failed, using local hashing embedder: %s", exc)
    return _hasher.transform(texts).toarray().astype(np.float32), "hashing-512"


def chunk(doc: str, size: int = 900, overlap: int = 150) -> list[str]:
    """Split on headings/paragraphs, then pack into ~size-char chunks with overlap."""
    parts = [p.strip() for p in re.split(r"\n(?=#)|\n\n", doc) if p.strip()]
    chunks, cur = [], ""
    for p in parts:
        if len(cur) + len(p) + 1 > size and cur:
            chunks.append(cur)
            tail = cur[-overlap:]
            tail = tail[tail.find("\n") + 1:] if "\n" in tail else ""
            cur = (tail + "\n" + p).strip()
        else:
            cur = (cur + "\n" + p).strip()
    if cur:
        chunks.append(cur)
    return chunks


def has_pgvector() -> bool:
    row = db.fetch_one("select exists(select 1 from pg_attribute where attrelid = 'public.knowledge_chunks'::regclass and attname = 'embedding_vec') as ok")
    return bool(row and row["ok"])


def ingest(title: str, content: str, doc_type: str, org_id: str | None = None, source: str | None = None) -> str:
    chunks = chunk(content)
    vecs, model = embed(chunks)
    pgv = has_pgvector() and vecs.shape[1] == 512
    with db.transaction() as c:
        doc_id = c.execute(text("""insert into knowledge_documents(organization_id, title, doc_type, source, content)
                                   values (:o, :t, :d, :s, :c) returning id::text"""),
                           {"o": org_id, "t": title, "d": doc_type, "s": source, "c": content}).scalar_one()
        for i, (ch, v) in enumerate(zip(chunks, vecs)):
            c.execute(text(f"""insert into knowledge_chunks(document_id, organization_id, chunk_index, content, embedding, embedding_model
                               {', embedding_vec' if pgv else ''})
                               values (:d, :o, :i, :c, :e, :m {', cast(:v as vector)' if pgv else ''})"""),
                      {"d": doc_id, "o": org_id, "i": i, "c": ch, "e": v.tolist(), "m": model, "v": json.dumps(v.tolist())})
    return doc_id


def seed_global_docs() -> int:
    """(Re)load the bundled policy documents when their content changed."""
    n = 0
    for path in sorted(DOCS_DIR.glob("*.md")):
        content = path.read_text(encoding="utf-8")
        title = content.splitlines()[0].lstrip("# ").strip()
        existing = db.fetch_one("select id::text, content from knowledge_documents where organization_id is null and source = :s", s=path.name)
        if existing and existing["content"] == content:
            continue
        if existing:
            db.execute("delete from knowledge_documents where id = :i", i=existing["id"])
        doc_type = {"pricing_policy.md": "PRICING_POLICY", "inventory_rules.md": "INVENTORY_RULE"}.get(path.name, "OPERATIONS")
        ingest(title, content, doc_type, None, path.name)
        n += 1
    return n


def search(query: str, org_id: str | None, k: int = 4) -> list[dict]:
    rows = db.fetch_all(
        """select c.id::text, c.content, c.embedding, c.embedding_model, d.title, d.source, d.doc_type
           from knowledge_chunks c join knowledge_documents d on d.id = c.document_id
           where c.organization_id is null or c.organization_id = cast(:o as uuid)""", o=org_id)
    if not rows:
        return []
    qv, model = embed([query])
    usable = [r for r in rows if r["embedding_model"] == model and len(r["embedding"]) == qv.shape[1]]
    if not usable:
        return []
    M = np.array([r["embedding"] for r in usable], dtype=np.float32)
    scores = M @ qv[0]
    order = np.argsort(-scores)[:k]
    return [{"title": usable[i]["title"], "source": usable[i]["source"], "doc_type": usable[i]["doc_type"],
             "content": usable[i]["content"], "score": round(float(scores[i]), 4)} for i in order if scores[i] > 0.05]
