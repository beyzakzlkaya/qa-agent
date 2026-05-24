# lib/tc-planner

Risk skoru ve coverage'a göre test case'leri önceliklendiren plan oluşturucu.

## Kullanım

```typescript
import { createTestPlan, runWithPlan } from "@/lib/tc-planner";
import { getTestPlan } from "@/lib/tc-planner";

// 1. Plan oluştur (PR risk analizinden)
const plan = await createTestPlan({
  riskAnalysis: analysis,
  maxTestCases: 15,
  includeRegression: true,
});

// 2. Plan ile test koş
const runId = await runWithPlan(plan.id, {
  name: "PR #123 Risk-Based Run",
  environment: "preprod",
  runType: "regression",
});

// 3. Yeni TC üret (opsiyonel)
import { generateTestCase } from "@/lib/tc-planner";
const newTc = await generateTestCase({
  title: "Login timeout testi",
  description: "Oturum zaman aşımı sonrası yeniden login kontrolü",
  priority: "high",
  targetScreen: "partner",
});
```

## Önceliklendirme Mantığı

1. **+100 puan**: Risk analizi tarafından önerilen TC'ler (`suggestedTestCaseIds`)
2. **+80 puan**: Son 7 günde başarısız olan TC'ler
3. **+60 puan**: Etkilenen ekranlarla eşleşen TC'ler (`affectedScreens`)
4. **+40 puan**: Hiç koşulmamış TC'ler
5. **+0-30 puan**: Priority weight (critical=30, high=20, medium=10, low=0)

## Üretilen TC'ler

`generateTestCase()` ile üretilen TC'ler:
- `data/test-cases/{targetScreen}/generated/generated.json` dosyasına kaydedilir
- ID formatı: `GEN-{timestamp}-{index}`
- Domain context ile zenginleştirilmiş prompt içerir
