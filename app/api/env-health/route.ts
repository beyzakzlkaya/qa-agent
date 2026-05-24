import { NextResponse } from "next/server";
import { ENVIRONMENTS } from "@/lib/config/environments";

export interface EnvProbe {
  url: string;
  status: "up" | "down" | "degraded";
  httpStatus?: number;
  latencyMs?: number;
}

export interface EnvHealth {
  env: "preprod" | "prod";
  overall: "up" | "down" | "degraded";
  probes: Record<string, EnvProbe>;
}

async function probe(url: string): Promise<EnvProbe> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    const latencyMs = Date.now() - start;
    const status: EnvProbe["status"] =
      res.status >= 500 ? "down" : res.status >= 400 ? "degraded" : "up";
    return { url, status, httpStatus: res.status, latencyMs };
  } catch {
    return { url, status: "down", latencyMs: Date.now() - start };
  }
}

async function checkEnv(env: "preprod" | "prod"): Promise<EnvHealth> {
  const urls = ENVIRONMENTS[env];
  const entries = Object.entries(urls) as ["backoffice" | "partner" | "website", string][];
  const results = await Promise.all(entries.map(([, u]) => probe(u)));
  const probes: Record<string, EnvProbe> = {};
  entries.forEach(([key], i) => {
    probes[key] = results[i];
  });

  const anyDown = results.some((r) => r.status === "down");
  const anyDegraded = results.some((r) => r.status === "degraded");
  const overall: EnvProbe["status"] = anyDown ? "down" : anyDegraded ? "degraded" : "up";

  return { env, overall, probes };
}

export async function GET() {
  const [preprod, prod] = await Promise.all([checkEnv("preprod"), checkEnv("prod")]);
  return NextResponse.json({ preprod, prod });
}
