"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start with "light" to match SSR — avoids hydration mismatch.
  // The inline <script> in layout.tsx already applies the dark class visually
  // before React renders, so there's no flash even though state starts as "light".
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // After hydration, sync state with what the inline script applied to <html>
    const isDark = document.documentElement.classList.contains("dark");
    if (isDark) setTheme("dark");
  }, []);

  const toggle = () => {
    document.documentElement.style.transition =
      "background-color 0.2s ease, color 0.2s ease";

    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      document.documentElement.classList.toggle("dark", next === "dark");
      localStorage.setItem("qa-theme", next);
      return next;
    });

    setTimeout(() => {
      document.documentElement.style.transition = "";
    }, 300);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
