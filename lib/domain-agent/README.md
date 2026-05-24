# lib/domain-agent

Domain bilgisi RAG (Retrieval-Augmented Generation) modülü.

## Amaç

Getmobil e2e test prompt library GitHub reposundan domain bilgisini öğrenerek, test case generation ve execution sırasında LLM'e semantik olarak ilgili context sağlar.

## Mimari

```
GitHub Repo (.md/.txt files)
        │
        ▼
indexer.ts → chunk → Voyage-3 embedding → SQLite (domain_embeddings)
        │
        ▼
search.ts → query embedding → cosine similarity → top-K results
        │
        ▼
context-builder.ts → formatted string → LLM prompt injection
```

## Kullanım

### 1. İlk indeksleme

```bash
npx tsx scripts/index-domain.ts
```

### 2. Yeniden indeksleme (--refresh)

```bash
npm run index-domain:refresh
# veya
npx tsx scripts/index-domain.ts --refresh
```

### 3. Kod içinde kullanım

```typescript
import { buildDomainContext } from "@/lib/domain-agent";

const context = await buildDomainContext("kullanıcı login akışı");
// Returns formatted markdown context string
```

## Env Değişkenleri

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `GITHUB_TOKEN` | GitHub API token (repo scope) | — |
| `GITHUB_OWNER` | Repo sahibi | `Getmobil` |
| `GITHUB_REPO` | Repo adı | `getmobil-e2e-test-prompt-library` |
| `EMBEDDING_MODEL` | Embedding modeli | `voyage-3` |
| `VOYAGE_API_KEY` | Voyage AI API key (veya Anthropic key) | — |

## SQLite Tablo

```sql
domain_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding BLOB NOT NULL,   -- Float32Array
  metadata TEXT,             -- JSON: { heading, file_type, repo }
  created_at TEXT
)
```

## Chunking Stratejisi

- Dosya başlıklara göre bölünür (`## Heading`)
- Her chunk max ~512 token (≈2048 karakter)
- 50 token (≈200 karakter) overlap
- Büyük section'lar sliding window ile alt chunk'lara bölünür

## Similarity Threshold

`buildDomainContext` score < 0.65 olan sonuçları filtreler (Voyage-3 için önerilen threshold).
