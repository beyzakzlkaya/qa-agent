/**
 * lib/jira-pipeline/module-map.ts
 *
 * PR'da değişen dosya yollarından iş modüllerini (Türkçe) çıkarır.
 * Detection için her modülün:
 *  - `patterns`: dosya yolunda eşleşecek regex listesi
 *  - `keywords`: opsiyonel, yol içerisinde geçen anahtar kelime fallback'i
 *
 * Yeni modül eklemek için MODULE_DEFINITIONS dizisine satır ekleyin —
 * ilk eşleşen modül kazanır (sıralama önemlidir).
 */

export interface ModuleDefinition {
  /** UI'da gösterilecek Türkçe etiket */
  label: string;
  /** Modül ile ilgili risk vurgusu için renk */
  tone: "default" | "warning" | "danger";
  /** Dosya yoluna karşı çalıştırılan regex pattern'leri */
  patterns: RegExp[];
}

const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    label: "Sipariş",
    tone: "warning",
    patterns: [/\/order\//i, /\/orders\//i, /\/checkout\//i, /\/cart\//i, /siparis|sepet/i],
  },
  {
    label: "Ödeme",
    tone: "warning",
    patterns: [/\/payment\//i, /\/billing\//i, /odeme|fatura/i, /payment-?service/i],
  },
  {
    label: "İade",
    tone: "default",
    patterns: [/\/refund\//i, /\/return\//i, /iade|refund/i],
  },
  {
    label: "Kimlik",
    tone: "danger",
    patterns: [/\/auth\//i, /\/login\//i, /\/identity\//i, /\/otp\//i, /\/session\//i, /jwt|token/i],
  },
  {
    label: "Envanter",
    tone: "default",
    patterns: [/\/inventory\//i, /\/stock\//i, /envanter|stok/i],
  },
  {
    label: "Trade-In",
    tone: "default",
    patterns: [/trade-?in/i, /takas/i],
  },
  {
    label: "BuyBack",
    tone: "default",
    patterns: [/buy-?back/i, /geri-?alim/i],
  },
  {
    label: "Garanti",
    tone: "default",
    patterns: [/warranty/i, /garanti/i],
  },
  {
    label: "Refurbishment",
    tone: "default",
    patterns: [/refurbish/i, /yenileme/i],
  },
  {
    label: "Kullanıcı",
    tone: "default",
    patterns: [/\/user\//i, /\/account\//i, /\/profile\//i, /kullanici|hesap|profil/i],
  },
  {
    label: "Ürün Katalog",
    tone: "default",
    patterns: [/\/product\//i, /\/catalog\//i, /\/category\//i, /urun|katalog|kategori/i],
  },
  {
    label: "Arama",
    tone: "default",
    patterns: [/\/search\//i, /\/filter\//i, /arama|filtre/i],
  },
  {
    label: "Bildirim",
    tone: "default",
    patterns: [/\/notification\//i, /\/messaging\//i, /bildirim|sms|email-template/i],
  },
  {
    label: "Backoffice",
    tone: "default",
    patterns: [/\/backoffice\//i, /\/admin\//i, /\/bo[/-]/i],
  },
  {
    label: "Partner",
    tone: "default",
    patterns: [/\/partner\//i, /\/dealer\//i, /bayi/i],
  },
  {
    label: "Website",
    tone: "default",
    patterns: [/\/website\//i, /\/storefront\//i, /apps\/web\//i],
  },
  {
    label: "Dashboard",
    tone: "default",
    patterns: [/\/dashboard\//i, /\/analytics\//i],
  },
  {
    label: "Kargo",
    tone: "default",
    patterns: [/\/shipping\//i, /\/delivery\//i, /kargo|teslimat/i],
  },
  {
    label: "Kampanya",
    tone: "default",
    patterns: [/\/campaign\//i, /\/promo\//i, /\/coupon\//i, /kampanya|kupon|promosyon/i],
  },
  {
    label: "Banner",
    tone: "default",
    patterns: [/\/banner\//i, /\/hero\//i],
  },
  {
    label: "Config",
    tone: "warning",
    patterns: [/\.env(\.|$)/i, /\/config\//i, /\.config\./i, /next\.config|tailwind\.config/i],
  },
  {
    label: "Test",
    tone: "default",
    patterns: [/\.test\.|\.spec\.|\/e2e\/|__tests__\/|cypress\/|playwright\//i],
  },
];

export interface DetectedModule {
  label: string;
  tone: ModuleDefinition["tone"];
  /** Bu modüle eşlenen dosya sayısı */
  fileCount: number;
}

/**
 * Dosya yolları listesinden etkilenen modülleri tespit eder.
 * Dosya başına en fazla bir modül; aynı modül birden çok dosyaya eşleşirse
 * `fileCount` artar. Sonuç en yüksek fileCount'a göre sıralı döner.
 */
export function detectModulesFromFiles(filePaths: string[]): DetectedModule[] {
  const counts = new Map<string, { def: ModuleDefinition; count: number }>();

  for (const path of filePaths) {
    const matched = MODULE_DEFINITIONS.find((m) =>
      m.patterns.some((p) => p.test(path))
    );
    if (!matched) continue;
    const existing = counts.get(matched.label);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(matched.label, { def: matched, count: 1 });
    }
  }

  return Array.from(counts.values())
    .map(({ def, count }) => ({ label: def.label, tone: def.tone, fileCount: count }))
    .sort((a, b) => b.fileCount - a.fileCount);
}

/**
 * Kompakt görüntü için ilk N modülü "+M" suffix'i ile döndürür.
 * Liste kartlarındaki yer kısıtlaması nedeniyle kullanılır.
 */
export function formatModuleSummary(
  modules: DetectedModule[],
  maxVisible = 3
): { visible: DetectedModule[]; remaining: number } {
  return {
    visible: modules.slice(0, maxVisible),
    remaining: Math.max(0, modules.length - maxVisible),
  };
}
