export type RunStatus = "failed" | "running" | "passed" | "partial";

export interface Run {
  id: string;
  name: string;
  status: RunStatus;
  env: string;
  type: "Regresyon" | "Özel";
  passed: number;
  failed: number;
  total: number;
  duration: string;
  date: string;
  /** ISO timestamp of run start — used for time-bucketed aggregations. */
  startedAtIso?: string;
}

export const runs: Run[] = [
  { id: "1", name: "deneme kupon", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "41s", date: "12.04.26 17:11" },
  { id: "2", name: "KUPON5", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "29s", date: "12.04.26 17:02" },
  { id: "3", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "21s", date: "12.04.26 17:01" },
  { id: "4", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "2m 7s", date: "12.04.26 16:41" },
  { id: "5", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 1, total: 1, duration: "2m 28s", date: "12.04.26 16:04" },
  { id: "6", name: "[JIRA] NE-8960: Website - Bir buyback leade i oluşturulurken now date in bul", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 9, total: 9, duration: "1m 3s", date: "12.04.26 15:52" },
  { id: "7", name: "Kupon4", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 16s", date: "12.04.26 11:08" },
  { id: "8", name: "Kupon3 (Tekrar)", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 34, total: 34, duration: "113m 46s", date: "12.04.26 03:41" },
  { id: "9", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "5m 0s", date: "10.04.26 18:02" },
  { id: "10", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 11s", date: "10.04.26 17:18" },
  { id: "11", name: "kupon2", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "0s", date: "10.04.26 16:48" },
  { id: "12", name: "Kupon (Tekrar)", status: "running", env: "Preprod", type: "Özel", passed: 0, failed: 0, total: 34, duration: "4554m 58s", date: "10.04.26 16:47" },
  { id: "13", name: "Kupon", status: "failed", env: "Preprod", type: "Özel", passed: 2, failed: 5, total: 7, duration: "3m 22s", date: "10.04.26 14:30" },
  { id: "14", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 1, failed: 2, total: 3, duration: "1m 45s", date: "10.04.26 13:15" },
  { id: "15", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 2, total: 2, duration: "58s", date: "10.04.26 12:00" },
  { id: "16", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 10s", date: "10.04.26 10:00" },
  { id: "17", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 05s", date: "09.04.26 10:00" },
  { id: "18", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "2m 10s", date: "09.04.26 16:30" },
  { id: "19", name: "KUPON5", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "35s", date: "09.04.26 15:00" },
  { id: "20", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 4, total: 4, duration: "1m 52s", date: "09.04.26 14:00" },
  { id: "21", name: "deneme kupon", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "38s", date: "09.04.26 11:00" },
  { id: "22", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "25s", date: "09.04.26 10:30" },
  { id: "23", name: "Kupon4", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 5s", date: "08.04.26 17:00" },
  { id: "24", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 20s", date: "08.04.26 10:00" },
  { id: "25", name: "Kupon3 (Tekrar)", status: "failed", env: "Preprod", type: "Özel", passed: 3, failed: 12, total: 15, duration: "45m 20s", date: "08.04.26 08:00" },
  { id: "26", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 2, total: 2, duration: "1m 10s", date: "08.04.26 07:30" },
  { id: "27", name: "KUPON5", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "27s", date: "07.04.26 16:00" },
  { id: "28", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 30s", date: "07.04.26 15:00" },
  { id: "29", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 2, failed: 1, total: 3, duration: "30s", date: "07.04.26 14:00" },
  { id: "30", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 15s", date: "07.04.26 10:00" },
  { id: "31", name: "deneme kupon", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "44s", date: "07.04.26 09:00" },
  { id: "32", name: "Kupon4", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 20s", date: "06.04.26 16:00" },
  { id: "33", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 5, total: 5, duration: "2m 40s", date: "06.04.26 15:00" },
  { id: "34", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 00s", date: "06.04.26 10:00" },
  { id: "35", name: "KUPON5", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "31s", date: "06.04.26 09:30" },
  { id: "36", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "22s", date: "06.04.26 09:00" },
  { id: "37", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 50s", date: "05.04.26 17:00" },
  { id: "38", name: "kupon2", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "0s", date: "05.04.26 16:30" },
  { id: "39", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "1m 35s", date: "05.04.26 15:00" },
  { id: "40", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 30s", date: "05.04.26 10:00" },
  { id: "41", name: "deneme kupon", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "40s", date: "05.04.26 09:00" },
  { id: "42", name: "Kupon4", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 00s", date: "04.04.26 16:00" },
  { id: "43", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 1, failed: 2, total: 3, duration: "28s", date: "04.04.26 15:00" },
  { id: "44", name: "smoke-test-preprod", status: "passed", env: "Preprod", type: "Regresyon", passed: 12, failed: 0, total: 12, duration: "4m 10s", date: "04.04.26 10:00" },
  { id: "45", name: "Kupon3 (Tekrar)", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 8, total: 8, duration: "30m 15s", date: "04.04.26 08:00" },
  { id: "46", name: "[JIRA] NE-8960", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 2, total: 2, duration: "1m 20s", date: "04.04.26 07:30" },
  { id: "47", name: "KUPON5", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "33s", date: "03.04.26 16:00" },
  { id: "48", name: "[JIRA] NE-8610", status: "failed", env: "Preprod", type: "Regresyon", passed: 0, failed: 3, total: 3, duration: "24s", date: "03.04.26 15:30" },
  { id: "49", name: "Kupon3", status: "failed", env: "Preprod", type: "Özel", passed: 0, failed: 1, total: 1, duration: "1m 40s", date: "03.04.26 14:00" },
];

export const mockErrorMap: Record<string, { errorType: string; stackTrace: string[] }> = {
  default: {
    errorType: "AssertionError",
    stackTrace: [
      "AssertionError: Expected element to be visible but it was not found",
      "  at Page.waitForSelector (/app/node_modules/playwright/lib/page.js:312:15)",
      "  at Object.<anonymous> (/tests/kupon.spec.ts:48:20)",
    ],
  },
  timeout: {
    errorType: "TimeoutError",
    stackTrace: [
      "TimeoutError: page.waitForSelector: Timeout 30000ms exceeded",
      "  at Page.waitForSelector (/app/node_modules/playwright/lib/page.js:298:7)",
      "  at Object.<anonymous> (/tests/regression.spec.ts:72:14)",
    ],
  },
};
