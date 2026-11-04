import * as React from "react";

type Theme = "light" | "dark";
const KEY = "campaignos-theme";

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Theme is a per-browser convenience; it is not product data. */
export function useTheme() {
  const [theme, setTheme] = React.useState<Theme>(read);
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
