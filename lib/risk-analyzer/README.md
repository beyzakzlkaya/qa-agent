# lib/risk-analyzer

GitHub PR diff'ini analiz edip risk seviyesi, etkilenen ekranlar ve önerilen test senaryolarını tespit eden modül.

## Kullanım

```typescript
import { fetchPRDiff, analyzeRisk } from "@/lib/risk-analyzer";

const diff = await fetchPRDiff(123);          // PR #123
const analysis = await analyzeRisk(diff);     // LLM analizi

console.log(analysis.riskLevel);             // "high"
console.log(analysis.affectedScreens);       // ["backoffice", "partner"]
```

## Risk Seviyeleri

| Seviye | Açıklama |
|---|---|
| `critical` | Production'ı doğrudan etkileyen değişiklikler |
| `high` | Önemli ekranları/servisleri etkileyen değişiklikler |
| `medium` | Orta etki — genel regression risk var |
| `low` | Küçük değişiklikler, düşük risk |

## SQLite Tablosu

```sql
risk_analyses (
  id, pr_number, jira_issue_key, risk_level, risk_score,
  analysis_json,   -- tam RiskAnalysis JSON
  created_at
)
```

## Jira Entegrasyonu

`reportToJira` fonksiyonuna `riskAnalysis` geçilince Jira yorumuna otomatik risk özeti eklenir:
- Risk seviyesi badge
- Etkilenen ekranlar
- Regresyon riskleri
- Önerilen test senaryoları
