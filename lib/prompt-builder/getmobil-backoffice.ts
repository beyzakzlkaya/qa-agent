/**
 * lib/prompt-builder/getmobil-backoffice.ts
 *
 * Platform knowhow for the Getmobil Backoffice surface.
 *
 * The navigation map below is sourced DETERMINISTICALLY from the real
 * application code: apps/backoffice/src/routes.js in the
 * Getmobil/getmobil-frontend-turborepo repository. Nothing is fabricated.
 *
 * Why this exists: menu labels do NOT always match URL slugs (e.g. the menu
 * item "Channel Management" lives at /rmm/sales-rules). Agents that guess
 * URLs from labels — or scroll the huge left menu hunting for a label — get
 * lost. Direct URL navigation from this map is the reliable path.
 */

/** Menü etiketi → URL path eşlemesi (kaynak: routes.js). */
export const BACKOFFICE_ROUTES: Record<string, string> = {
  "Genel Görünüm": "/dashboards/default",
  "Duyuru Oluştur": "/announcements/create",
  "Giriş-Çıkış": "/clock-in-out",
  "Rapor": "/management/report",
  "Regrade": "/management/regrade",
  "Pazaryeri Komisyon Yönetimi": "/rmm/vendor-commissions",
  "Fiyat Yönetimi": "/ecommerce/database-import",
  "Model Yönetimi": "/management/buyback-models",
  "Soru Kataloğu": "/buyback/question-catalog",
  "Bileşenler": "/buyback/components",
  "Channel Management": "/rmm/sales-rules",
  "Tezgah Cihaz Fiyatları": "/ecommerce/tezgah-prices",
  "Ürün Aksesuar Eşleştirme": "/ecommerce/product-accessory-mapping",
  "Premium Variant Oluştur": "/management/premium-variants",
  "Yeni Kampanya": "/management/campaigns/new",
  "Grade Güncelleme V2": "/ecommerce/grading-model-components-update",
  "Hızlı Sipariş Stok Yönetimi": "/fast-buy-stock-management",
  "Tek Kullanımlık Kampanyalar": "/one-time-campaigns",
  "Hızlı Sipariş Fırsatı": "/opportunities/fast-buy",
  "Komisyon Fırsatı": "/opportunities/commission",
  "Duyurular": "/rmm/announcements",
  "Komisyon Kampanya Yönetimi": "/rmm/campaigns",
  "Bayilik Başvuruları": "/rmm/new-applications",
  "Ceza Senaryo Yönetimi": "/rmm/senario-management",
  "Bayi Ceza Yönetimi": "/rmm/vendor-penalty-management",
  "Buyback Admin Panel": "/rmm/buyback-admin-panel",
  "Buyback Müşteri Kapatma": "/rmm/user-ban",
  "Gamification Yönetimi": "/rmm/gamification-management",
  "Garanti Bloke Takibi": "/rmm/warranty-blocks",
  "Açık Arttırma Ayarları": "/rmm/auction-settings",
  "Bayi Kapat / Aç": "/rmm/vendor-status",
  "Yenileme Merkezleri": "/rmm/refurbishment-centers",
  "YYM Başvuruları": "/refurbish_center_application",
  "Bayi Bilgileri": "/vendor-management",
  "Sözleşme Yönetimi": "/franchise/contract-management",
  "Kategori SEO": "/marketing/category-seo",
  "Blog": "/marketing/blog",
  "Ürün Grubu Yönetimi": "/marketing/product-group-management",
  "Kategoriler": "/marketing/categories",
  "Varyant Yönetimi": "/marketing/buyback-models",
  "Anasayfa Yönetimi": "/marketing/homepage-components",
  "Kampanya Yönetimi": "/category-management/campaign",
  "Carousel Oluştur": "/category-management/campaign/create-campaign",
  "Kupon Yönetimi": "/coupon-management",
  "Kupon Oluştur": "/coupon-management/new",
  "Ürün Grubu Oluştur": "/category-management/create-product-group",
  "Kargoyla Alınacaklar": "/buyback/cargo-leads",
  "Kapıdan Alınacaklar": "/buyback/courier-leads",
  "Takaslı Kurye Alımları": "/buyback/trade-in-courier-leads",
  "Mağazadan Alınacaklar": "/buyback/store-leads",
  "Toplu Alınacaklar": "/buyback/bulk-leads",
  "Back Office Ayarlar": "/bidbook/variant-buyback-prices",
  "Bayiye Atananlar": "/bidbook/vendor-bidbook/waiting-for-payment-v2",
  "Ödeme Takibi": "/bidbook/vendor-bidbook/payment-tracking",
  "Onay Bekleyenler V2": "/bidbook/vendor-bidbook/waiting-for-approval-v2",
  "Ceza Listesi": "/bidbook/vendor-bidbook/penalty-list",
  "Aldıklarım V2": "/bidbook/vendor-bidbook/my-purchases-v2",
  "Grade İtirazları": "/bidbook/grade-objections",
  "Bayi Listesi": "/bidbook/request-list",
  "Ön Kontrol": "/refurbishment-center-v2/pre-control",
  "Mekanik Onarım": "/refurbishment-center-v2/mechanical-repair",
  "Garanti & İade": "/refurbishment-center-v2/warranty-repair",
  "Kalite Kontrol": "/refurbishment-center-v2/quality-control",
  "Son Kontrol": "/refurbishment-center-v2/last-control",
  "Depo": "/refurbishment-center-v2/storage-page",
  "Parça Stok Yönetimi": "/refurbishment-center-v2/part-stock-management",
  "Ürün Kontrol": "/refurbishment-center-v2/product-control",
  "Hologram Listesi": "/refurbishment-center-v2/hologram-list",
  "Stok Sayım": "/refurbishment-center-v2/stock-count",
  "Cihazlarım": "/vendor/device-list",
  "Aksesuarlarım": "/inventory/list/accessories",
  "Şirket İçi Kullanım": "/inventory/company-internal-use",
  "Siparişler": "/order-management",
  "Garanti Yönetimi": "/warranty",
  "İade Yönetimi": "/return-management",
  "Mağazada Satılanlar": "/in-store-management",
  "Bayi Fatura Yönetimi": "/invoice-management",
  "Imei Değişimi Yapılanlar": "/order-management/imei-change-logs",
  "Para Çıkış Yönetimi": "/finance/payout-management",
  "Otomatik İade Yönetimi": "/finance/refund-settings",
  "Kasa İşlemleri": "/finance/kasa",
  "Hakediş - Admin": "/finance/admin-payout",
  "Hakediş - Bayi Görünümü": "/finance/payout",
  "Hakediş - Siparişler": "/finance/sellorder",
  "Komisyon Faturaları": "/finance/invoices",
  "Logo Operasyonları": "/finance/logo-operations",
  "Fatura Mutabakat": "/finance/invoice-reconciliation",
  "Fatura İşlemleri": "/finance/invoice-operations",
  "Finansal Alış": "/buyback/partner/financial-buy",
  "Finansal Satış": "/buyback/partner/financial-sell",
  "Dashboard": "/sales-automation/dashboard",
  "Ziyaret Kaydı": "/sales-automation/visit",
  "Arama Kaydı": "/sales-automation/call",
  "Portföyüm": "/sales-automation/portfolio",
  "Aksiyon Merkezi": "/sales-automation/actions",
  "Satış Hedefleri": "/sales-automation/targets",
  "Takım Yönetimi": "/sales-automation/team-management",
  "Müşteri 360": "/marketing-automation/customers",
  "Senaryolar": "/marketing-automation/scenarios",
  "Müşteri Kartı": "/ecommerce/customer-card",
  "Task Havuzu": "/task-pool",
  "Kişi Grupları": "/ecommerce/user-groups",
  "Tüm Alımlar": "/ecommerce/buyback-leads",
  "Getmobil Kurye": "/musteri-iliskileri/getmobil-kurye",
  "Müşteri Soruları": "/musteri-iliskileri/musteri-sorulari",
  "Sipariş Oluştur": "/create-order",
  "İptal - İade Bekleyenler V2": "/ecommerce/refund-cancel-list-v2",
  "Anket Yönetimi": "/anket-yonetimi",
  "Kullanım Kılavuzları": "/kullanim-kilavuzlari",
  "Ürün Değerlendirmeleri": "/ecommerce/product-reviews",
  "İmei Kontrol": "/utils/imei-checker",
  "Toplu Imei Sorgusu": "/utils/bulk-imei-checker",
  "Grade Simulation": "/utils/grade-simulation",
  "Yetki Listesi": "/utils/permission-list",
  "Yetki Yönetimi": "/management/access-control",
  "Bayi Değiştir": "/utils/vendor-change",
  "SSS Yönetimi": "/utils/faq-management",
};

export function buildGetmobilBackofficeContext(): string {
  const routeLines = Object.entries(BACKOFFICE_ROUTES)
    .map(([label, route]) => `${label} => ${route}`)
    .join("\n");

  return `<getmobil_backoffice_context>

<platform>
Getmobil Backoffice is the internal admin panel (Turkish UI, some menu items in English).
It is a React SPA with a very long scrollable left-side menu.
</platform>

<navigation_strategy>
CRITICAL: Menu labels do NOT always match URL slugs. Example: the menu item
"Channel Management" lives at /rmm/sales-rules — guessing a URL from the label
or hunting for labels by scrolling the huge left menu is unreliable and slow.

To open a page, PREFER direct URL navigation using the route map below:
take the base URL of the current site and append the mapped path
(e.g. https://preprod-backoffice.getmobil.com + /rmm/sales-rules).
Use the go_to_url action for this. Only fall back to clicking through the
left menu if the target page is not in the map.

After direct navigation, verify the page content loaded (table, form or
header visible) before proceeding. If the page shows a permission error,
report it with done(false, "permission denied: <page>").
</navigation_strategy>

<route_map>
Menu label => URL path (source: apps/backoffice/src/routes.js — real application code)
${routeLines}
</route_map>

</getmobil_backoffice_context>`;
}
