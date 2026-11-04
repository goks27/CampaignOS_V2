import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        side: token("side"),
        surface: token("surface"),
        hover: token("hover"),
        active: token("active"),
        line: token("line"),
        "line-strong": token("line-strong"),
        text: token("text"),
        "text-2": token("text-2"),
        muted: token("muted"),
        accent: token("accent"),
        "on-accent": token("on-accent"),
        "st-green": "#2E9A5B",
        "st-blue": "#3A6FE0",
        "st-violet": "#7C5AD6",
        "st-amber": "#C98A12",
        "st-red": "#D2463C",
        "st-gray": "#9A9CA5",
      },
      fontFamily: {
        sans: ['"Geist Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono Variable"', "ui-monospace", "monospace"],
        display: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        xs: ["12px", "1.5"],
        sm: ["13px", "1.5"],
        base: ["13px", "1.5"],
        lg: ["18px", "1.35"],
        xl: ["20px", "1.3"],
        "2xl": ["28px", "1.15"],
        "3xl": ["40px", "1.08"],
      },
      borderRadius: { ctl: "6px", item: "7px", box: "10px" },
      maxWidth: { content: "1280px" },
      boxShadow: { overlay: "0 8px 30px rgb(0 0 0 / 0.12), 0 1px 3px rgb(0 0 0 / 0.08)" },
    },
  },
  plugins: [],
} satisfies Config;
