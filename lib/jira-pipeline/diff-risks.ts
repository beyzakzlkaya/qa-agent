/**
 * lib/jira-pipeline/diff-risks.ts
 *
 * PR diff'indeki riskli değişiklikleri tespit eden saf (pure) yardımcı fonksiyon.
 * Node.js bağımlılığı yoktur — hem client hem server tarafında kullanılabilir.
 */

import type { PrAnalysis } from "../types";

export function extractDiffRisks(pr: PrAnalysis): string[] {
  const risks: string[] = [];
  const allFiles = pr.changedFiles.join("\n");
  const allPatches = pr.fileChanges.map((f) => f.patch ?? "").join("\n");

  const totalDel = pr.fileChanges.reduce((s, f) => s + f.deletions, 0);
  if (totalDel > 100)
    risks.push(`${totalDel} satır silindi — kaldırılan mantık/fonksiyon test edilmeli`);

  // Auth & security
  if (/auth|permission|role|guard|middleware|token|jwt|session|otp|2fa/i.test(allPatches))
    risks.push("Auth/permission/OTP kodu değişti — yetkisiz erişim, oturum zaman aşımı ve OTP senaryoları test edilmeli");

  // API calls
  if (/fetch\(|axios\.|\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(|api\/|\/api\//i.test(allPatches))
    risks.push("API çağrısı değişti — hata durumları (400/401/404/500) ve başarı senaryoları test edilmeli");

  // Form validation
  if (/validation|required|minLength|maxLength|pattern|regex|yup|zod|validator/i.test(allPatches))
    risks.push("Form validasyonu değişti — boş alan, hatalı format, max/min sınır değerleri test edilmeli");

  // Deleted files
  const removedFiles = pr.fileChanges.filter((f) => f.status === "removed");
  if (removedFiles.length > 0)
    risks.push(
      `${removedFiles.length} dosya silindi (${removedFiles.map((f) => f.filename.split("/").pop()).join(", ")}) — bağlı sayfalarda 404/hata olmadığı test edilmeli`
    );

  // Routing
  if (/router|route|Link|href|navigate|redirect|push\(|replace\(/i.test(allPatches))
    risks.push("Sayfa yönlendirmesi değişti — navigasyon linkleri, deep link ve yönlendirme senaryoları test edilmeli");

  // Price / money
  if (/price|fiyat|tutar|amount|currency|TL|₺|discount|indirim|kdv|tax/i.test(allPatches))
    risks.push("Fiyat/tutar/vergi gösterimi değişti — para formatı, hesaplama doğruluğu ve kenar değerler test edilmeli");

  // Config/env
  if (/\.env|config\.|process\.env|APP_ENV|NODE_ENV/i.test(allFiles + allPatches))
    risks.push("Config/env değişkeni değişti — farklı ortamlarda (staging/prod) davranış test edilmeli");

  // State management
  if (/useState|useReducer|dispatch|redux|zustand|recoil|store\./i.test(allPatches))
    risks.push("State management değişti — sayfa yenileme, tab değiştirme ve state kalıcılığı test edilmeli");

  // UI components
  if (/Modal|Dialog|Drawer|Popover|Tooltip|Alert|Toast|Snackbar/i.test(allPatches))
    risks.push("Modal/Dialog/overlay bileşeni değişti — açılma, kapanma ve içerik doğruluğu test edilmeli");

  // Lists / pagination / infinite scroll
  if (/pagination|page|infinite|scroll|load more|loadMore|fetchMore/i.test(allPatches))
    risks.push("Liste/sayfalama mantığı değişti — boş liste, son sayfa ve sayfa geçişi test edilmeli");

  // Search / filter
  if (/filter|search|sort|query|keyword|arama|filtre/i.test(allPatches))
    risks.push("Arama/filtreleme/sıralama değişti — sonuçsuz arama, hatalı filtre ve kombinasyon senaryoları test edilmeli");

  // File upload
  if (/upload|file|FileReader|FormData|multipart/i.test(allPatches))
    risks.push("Dosya yükleme değişti — izin verilen/verilmeyen format ve max boyut senaryoları test edilmeli");

  // Image / media
  if (/image|img|photo|avatar|banner|carousel/i.test(allPatches))
    risks.push("Görsel/medya bileşeni değişti — eksik görsel ve yükleme hataları test edilmeli");

  // Notifications
  if (/notification|bildirim|toast|alert|banner/i.test(allPatches))
    risks.push("Bildirim/mesaj gösterimi değişti — başarı, hata ve uyarı mesajları test edilmeli");

  // Checkout / cart
  if (/sepetim|checkout|order|sipariş|payment|ödeme/i.test(allPatches))
    risks.push("Sepet/ödeme akışı değişti — ürün ekleme, çıkarma ve sipariş tamamlama test edilmeli");

  return risks;
}
