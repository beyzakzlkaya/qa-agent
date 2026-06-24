export type ErrorTypeName =
  | "UI / Element"
  | "API / Backend"
  | "Veri / Setup"
  | "Timeout / Performans"
  | "Diğer";

export type ErrorTypeOwner = "FE" | "BE" | "QA" | "DevOps" | "—";

export interface ErrorTypeBucket {
  type: ErrorTypeName;
  count: number;
  owner: ErrorTypeOwner;
}

export const OWNER_BY_TYPE: Record<ErrorTypeName, ErrorTypeOwner> = {
  "UI / Element": "FE",
  "API / Backend": "BE",
  "Veri / Setup": "QA",
  "Timeout / Performans": "DevOps",
  "Diğer": "—",
};

export function classifyErrorMessage(message: string | null | undefined): ErrorTypeName {
  const m = message ?? "";
  if (!m) return "Diğer";
  if (
    /NoSuchElement/i.test(m) ||
    /element\s+not\s+found/i.test(m) ||
    /locator/i.test(m) ||
    /selector/i.test(m) ||
    /could\s+not\s+find/i.test(m) ||
    /not\s+visible/i.test(m) ||
    /ElementNotInteractable/i.test(m)
  ) {
    return "UI / Element";
  }
  if (
    /HTTP\s*[45]\d{2}/i.test(m) ||
    /status\s*[:=]\s*[45]\d{2}/i.test(m) ||
    /500|502|503|504/.test(m) ||
    /backend/i.test(m) ||
    /api\s+error/i.test(m) ||
    /response/i.test(m)
  ) {
    return "API / Backend";
  }
  if (/timeout/i.test(m) || /timed\s+out/i.test(m) || /exceeded\s+\d+\s*ms/i.test(m)) {
    return "Timeout / Performans";
  }
  if (
    /fixture/i.test(m) ||
    /seed/i.test(m) ||
    /database/i.test(m) ||
    /db\s+error/i.test(m) ||
    /sql/i.test(m) ||
    /missing\s+(data|user|account)/i.test(m)
  ) {
    return "Veri / Setup";
  }
  return "Diğer";
}

export function emptyErrorTypeCounts(): Record<ErrorTypeName, number> {
  return {
    "UI / Element": 0,
    "API / Backend": 0,
    "Veri / Setup": 0,
    "Timeout / Performans": 0,
    "Diğer": 0,
  };
}

export function bucketsFromCounts(
  counts: Record<ErrorTypeName, number>
): ErrorTypeBucket[] {
  return (Object.entries(counts) as [ErrorTypeName, number][]).map(
    ([type, count]) => ({ type, count, owner: OWNER_BY_TYPE[type] })
  );
}
