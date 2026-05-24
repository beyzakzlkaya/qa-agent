import fs from "fs";
import path from "path";
import type { TestCase } from "../types";

const CASES_DIR = path.join(process.cwd(), "data", "test-cases");

export function loadTestCases(platform: string, tag: string): TestCase[] {
  const filePath = path.join(CASES_DIR, platform, `${tag}.json`);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as TestCase[];
  } catch {
    return [];
  }
}

export function loadAllCases(): TestCase[] {
  const platforms = ["backoffice", "partner", "website"];
  const tags = ["smoke", "regression", "monkey"];
  const all: TestCase[] = [];
  const seen = new Set<string>();

  for (const platform of platforms) {
    for (const tag of tags) {
      const cases = loadTestCases(platform, tag);
      for (const c of cases) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          all.push(c);
        }
      }
    }
  }

  return all;
}

export function loadCasesByTag(tag: string): TestCase[] {
  const platforms = ["backoffice", "partner", "website"];
  const all: TestCase[] = [];
  const seen = new Set<string>();

  for (const platform of platforms) {
    const cases = loadTestCases(platform, tag);
    for (const c of cases) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        all.push(c);
      }
    }
  }

  return all;
}

export function loadCasesByIds(ids: string[]): TestCase[] {
  const all = loadAllCases();
  return all.filter((c) => ids.includes(c.id));
}
