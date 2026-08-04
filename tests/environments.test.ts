import {
  ENVIRONMENTS,
  TARGET_URLS,
  getUrl,
  getTargetUrl,
} from "@/lib/config/environments";

describe("config/environments", () => {
  it("tüm ortam × platform kombinasyonları için URL döner", () => {
    for (const env of ["preprod", "prod"] as const) {
      for (const platform of ["backoffice", "partner", "website"] as const) {
        const url = getUrl(env, platform);
        expect(url).toMatch(/^https:\/\//);
        expect(url).toContain("getmobil.com");
      }
    }
  });

  it("preprod URL'leri preprod subdomain'i içerir", () => {
    expect(getUrl("preprod", "website")).toBe("https://preprod.getmobil.com/");
    expect(getUrl("preprod", "backoffice")).toContain("preprod-backoffice");
    expect(getUrl("preprod", "partner")).toContain("preprod-partner");
  });

  it("prod URL'leri preprod içermez", () => {
    for (const platform of ["backoffice", "partner", "website"] as const) {
      expect(getUrl("prod", platform)).not.toContain("preprod");
    }
  });

  it("getTargetUrl parametre sırası farklı olsa da aynı sonucu verir", () => {
    expect(getTargetUrl("website", "prod")).toBe(getUrl("prod", "website"));
    expect(getTargetUrl("backoffice", "preprod")).toBe(getUrl("preprod", "backoffice"));
  });

  it("TARGET_URLS, ENVIRONMENTS ile aynı referanstır", () => {
    expect(TARGET_URLS).toBe(ENVIRONMENTS);
  });

  it("ANTHROPIC_API_KEY yokken modül yüklenirken uyarı basar", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    jest.isolateModules(() => {
      require("@/lib/config/environments");
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY"));
    process.env.ANTHROPIC_API_KEY = old;
    spy.mockRestore();
  });
});
