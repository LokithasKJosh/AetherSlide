import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Sequence

from docx import Document
from PyPDF2 import PdfReader
import pdfplumber

try:
    import chromadb
    from chromadb.config import Settings
except Exception:  # noqa: BLE001
    chromadb = None
    Settings = None


def read_text_from_source(file_path: Path) -> str:
    ext = file_path.suffix.lower()
    if ext in {".txt", ".md"}:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    if ext == ".docx":
        doc = Document(str(file_path))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if ext == ".pdf":
        pages = []
        try:
            reader = PdfReader(str(file_path))
            for page in reader.pages:
                try:
                    text = (page.extract_text() or "").strip()
                except Exception:  # noqa: BLE001
                    text = ""
                if text:
                    pages.append(text)
        except Exception:  # noqa: BLE001
            pass

        extracted = "\n".join(page for page in pages if page).strip()
        if extracted:
            return extracted

        # Some encrypted/scanned PDFs are better handled by pdfplumber/pdfminer.
        try:
            with pdfplumber.open(str(file_path)) as pdf:
                alt_pages = []
                for page in pdf.pages:
                    try:
                        text = (page.extract_text() or "").strip()
                    except Exception:  # noqa: BLE001
                        text = ""
                    if text:
                        alt_pages.append(text)
            return "\n".join(alt_pages).strip()
        except Exception:  # noqa: BLE001
            return ""
    raise ValueError(f"Unsupported source file type: {ext}")


def normalize_text(text: str) -> str:
    cleaned = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def split_chunks(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []

    safe_size = max(256, int(chunk_size))
    safe_overlap = max(0, min(int(chunk_overlap), safe_size - 1))
    step = max(1, safe_size - safe_overlap)
    chunks: List[str] = []

    for start in range(0, len(normalized), step):
        chunk = normalized[start : start + safe_size].strip()
        if not chunk:
            continue
        chunks.append(chunk)
        if start + safe_size >= len(normalized):
            break
    return chunks


def tokenize_for_hash_embedding(text: str) -> List[str]:
    # Chinese uses per-character split, while alphanumerics keep word-level tokenization.
    return re.findall("[\u4e00-\u9fff]|[a-zA-Z0-9_]+", (text or "").lower())


def hash_embedding(text: str, dim: int = 384) -> List[float]:
    vector = [0.0] * dim
    tokens = tokenize_for_hash_embedding(text)
    if not tokens:
        return vector

    for token in tokens:
        digest = hashlib.md5(token.encode("utf-8")).hexdigest()
        h = int(digest, 16)
        idx = h % dim
        sign = -1.0 if ((h >> 8) & 1) else 1.0
        vector[idx] += sign

    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 1e-12:
        return vector
    return [v / norm for v in vector]


@dataclass
class RagConfig:
    persist_dir: Path
    collection_name: str
    source_files: Sequence[Path]
    chunk_size: int = 1000
    chunk_overlap: int = 180
    embedding_dim: int = 384


class RagEngine:
    def __init__(self, config: RagConfig) -> None:
        self.config = config
        self.config.persist_dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.config.persist_dir / "manifest.json"

        if chromadb is None:
            raise RuntimeError("chromadb is not installed. Please install requirements.txt first.")

        self.client = chromadb.PersistentClient(
            path=str(self.config.persist_dir),
            settings=Settings(
                anonymized_telemetry=False,
                chroma_telemetry_impl="backend.chroma_noop_telemetry.NoopTelemetry",
                chroma_product_telemetry_impl="backend.chroma_noop_telemetry.NoopTelemetry",
            ),
        )
        self.collection = self._create_collection()
        self._lexical_cache: List[Dict[str, Any]] = []

    def _create_collection(self):
        return self.client.get_or_create_collection(
            name=self.config.collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def _refresh_lexical_cache(self) -> None:
        cache: List[Dict[str, Any]] = []
        offset = 0
        page_size = 2000
        while True:
            batch = self.collection.get(limit=page_size, offset=offset, include=["documents", "metadatas"])
            docs = batch.get("documents") or []
            metas = batch.get("metadatas") or []
            if not docs:
                break
            for doc, meta in zip(docs, metas):
                md = meta or {}
                cache.append(
                    {
                        "text": doc or "",
                        "source_name": str(md.get("source_name", "")),
                        "source_path": str(md.get("source_path", "")),
                        "chunk_index": int(md.get("chunk_index", 0)),
                    }
                )
            if len(docs) < page_size:
                break
            offset += len(docs)
        self._lexical_cache = cache

    def _lexical_fallback_retrieve(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        if not self._lexical_cache:
            self._refresh_lexical_cache()
        if not self._lexical_cache:
            return []

        query_terms = set(tokenize_for_hash_embedding(query))
        query_term_count = max(1, len(query_terms))
        candidates: List[Dict[str, Any]] = []
        for item in self._lexical_cache:
            doc_terms = set(tokenize_for_hash_embedding(item["text"]))
            overlap = len(query_terms.intersection(doc_terms)) / query_term_count
            if overlap <= 0:
                continue
            candidates.append(
                {
                    "text": item["text"],
                    "source_name": item["source_name"],
                    "source_path": item["source_path"],
                    "chunk_index": item["chunk_index"],
                    "distance": 1.0 - overlap,
                    "score": overlap,
                    "vector_score": 0.0,
                    "lexical_overlap": overlap,
                }
            )
        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[: max(1, int(top_k))]

    def _source_signature(self) -> List[Dict[str, Any]]:
        signature: List[Dict[str, Any]] = []
        for source in self.config.source_files:
            item: Dict[str, Any] = {"path": str(source), "exists": source.exists()}
            if source.exists():
                stat = source.stat()
                item["size"] = stat.st_size
                item["mtime"] = int(stat.st_mtime)
            signature.append(item)
        return signature

    def _load_manifest(self) -> Dict[str, Any]:
        if not self.manifest_path.exists():
            return {}
        try:
            return json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    def _save_manifest(self, chunk_count: int) -> None:
        payload = {
            "collection_name": self.config.collection_name,
            "chunk_size": self.config.chunk_size,
            "chunk_overlap": self.config.chunk_overlap,
            "embedding_dim": self.config.embedding_dim,
            "chunk_count": int(chunk_count),
            "sources": self._source_signature(),
        }
        self.manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def needs_rebuild(self, force: bool = False) -> bool:
        if force:
            return True

        if self.collection.count() == 0:
            return True

        manifest = self._load_manifest()
        if not manifest:
            return True

        if manifest.get("chunk_size") != self.config.chunk_size:
            return True
        if manifest.get("chunk_overlap") != self.config.chunk_overlap:
            return True
        if manifest.get("embedding_dim") != self.config.embedding_dim:
            return True
        if manifest.get("collection_name") != self.config.collection_name:
            return True

        return manifest.get("sources") != self._source_signature()

    def _clear_collection(self) -> None:
        try:
            self.client.delete_collection(name=self.config.collection_name)
        except Exception:  # noqa: BLE001
            pass
        self.collection = self._create_collection()
        self._lexical_cache = []

    def _build_records(self) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        for source in self.config.source_files:
            if not source.exists():
                continue
            text = read_text_from_source(source)
            chunks = split_chunks(text, self.config.chunk_size, self.config.chunk_overlap)
            for chunk_idx, chunk in enumerate(chunks):
                records.append(
                    {
                        "id": f"{source.stem}_{chunk_idx}",
                        "text": chunk,
                        "source_path": str(source),
                        "source_name": source.name,
                        "chunk_index": chunk_idx,
                    }
                )
        return records

    def ensure_index_built(self, force: bool = False) -> Dict[str, Any]:
        if not self.needs_rebuild(force=force):
            if not self._lexical_cache:
                self._refresh_lexical_cache()
            return {
                "rebuilt": False,
                "chunk_count": self.collection.count(),
                "source_count": len(self.config.source_files),
            }

        records = self._build_records()
        self._clear_collection()

        if not records:
            self._save_manifest(chunk_count=0)
            return {"rebuilt": True, "chunk_count": 0, "source_count": len(self.config.source_files)}

        batch_size = 128
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            self.collection.add(
                ids=[item["id"] for item in batch],
                documents=[item["text"] for item in batch],
                metadatas=[
                    {
                        "source_path": item["source_path"],
                        "source_name": item["source_name"],
                        "chunk_index": item["chunk_index"],
                    }
                    for item in batch
                ],
                embeddings=[hash_embedding(item["text"], self.config.embedding_dim) for item in batch],
            )

        self._save_manifest(chunk_count=len(records))
        self._refresh_lexical_cache()
        return {"rebuilt": True, "chunk_count": len(records), "source_count": len(self.config.source_files)}

    def retrieve(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        if not query.strip():
            return []

        self.ensure_index_built(force=False)
        total = self.collection.count()
        if total == 0:
            return []

        query_embedding = hash_embedding(query, self.config.embedding_dim)
        n_results = min(max(int(top_k) * 15, int(top_k), 10), total)
        result = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )

        docs = (result.get("documents") or [[]])[0]
        metas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        query_terms = set(tokenize_for_hash_embedding(query))
        query_term_count = max(1, len(query_terms))

        candidates: List[Dict[str, Any]] = []
        for doc, meta, distance in zip(docs, metas, distances):
            dist = float(distance) if distance is not None else 0.0
            vector_score = 1.0 / (1.0 + dist)
            doc_terms = set(tokenize_for_hash_embedding(doc or ""))
            lexical_overlap = len(query_terms.intersection(doc_terms)) / query_term_count
            hybrid_score = vector_score * 0.55 + lexical_overlap * 0.45
            meta_obj = meta or {}
            candidates.append(
                {
                    "text": doc or "",
                    "source_name": str(meta_obj.get("source_name", "")),
                    "source_path": str(meta_obj.get("source_path", "")),
                    "chunk_index": int(meta_obj.get("chunk_index", 0)),
                    "distance": dist,
                    "score": hybrid_score,
                    "vector_score": vector_score,
                    "lexical_overlap": lexical_overlap,
                }
            )

        candidates.sort(key=lambda item: item.get("score", 0.0), reverse=True)
        final_hits = candidates[: max(1, int(top_k))]
        if final_hits and max(hit.get("lexical_overlap", 0.0) for hit in final_hits) > 0:
            return final_hits

        lexical_hits = self._lexical_fallback_retrieve(query, top_k=top_k)
        return lexical_hits or final_hits



