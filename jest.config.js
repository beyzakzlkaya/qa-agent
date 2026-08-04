/**
 * Birim test + coverage yapılandırması.
 *
 * Coverage kapsamı: deterministik, birim test edilebilir çekirdek modüller
 * (db katmanı, screenshot-diff, snapshot-engine, config). React sayfaları,
 * API route sarmalayıcıları ve ağ-bağımlı bridge/LLM kodu birim kapsamı
 * DIŞINDADIR — bunlar platformun kendi E2E koşumlarıyla test edilir.
 *
 * Eşik: %85 — altına düşerse `npm test -- --coverage` fail olur.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFiles: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2020",
          lib: ["es2020", "dom"],
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          paths: { "@/*": ["./*"] },
        },
      },
    ],
    // pixelmatch v6 ESM-only — jest'in CJS runtime'ı için ts-jest ile transpile
    "^.+\\.js$": [
      "ts-jest",
      {
        tsconfig: {
          allowJs: true,
          module: "commonjs",
          target: "ES2020",
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!pixelmatch)"],
  collectCoverageFrom: [
    "lib/config/environments.ts",
    "lib/db/**/*.ts",
    "lib/screenshot-diff/**/*.ts",
    "lib/snapshot-engine/**/*.ts",
  ],
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 85,
      functions: 85,
      lines: 85,
    },
  },
  testTimeout: 30000,
};
