# Memory Strategy

## Is ChromaDB Required?

No, not for the first usable Guild AI.

ChromaDB is useful when Guild AI needs L3 semantic memory:

- search old lessons by meaning, not exact keywords;
- store brand manuals and operating procedures;
- let new agents retrieve prior project knowledge;
- support RAG over documents, transcripts, and research.

For Phase 0 to Phase 2, SQLite is enough for:

- guild templates;
- task records;
- agent state;
- accounting records;
- HR scoring;
- audit logs;
- daily summaries.

## Recommended Default

Notebook/local:

```text
VECTOR_DB_PROVIDER=none
```

Server/production:

```text
VECTOR_DB_PROVIDER=chroma
```

Docker with ChromaDB:

```bash
docker compose --profile rag up -d
```

## Why Keep It Optional

Making ChromaDB mandatory adds operational weight too early. A solo developer should be able to run the system with Node.js and SQLite first, then turn on vector memory when the core workflow is stable.

## Long-Term Shape

Use a memory adapter interface:

```text
MemoryProvider
  - none
  - sqlite
  - chroma
```

This lets the same Guild AI logic run:

- offline on one notebook;
- on a LAN server;
- on an internet-facing deployment with stronger infrastructure.
