import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f7f8fb",
        foreground: "#172033",
        border: "#d9dfeb",
        muted: "#667085",
        panel: "#ffffff",
        accent: "#2563eb",
        positive: "#047857",
        negative: "#b42318"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 24, 40, 0.06)"
      }
    }
  },
  plugins: [tailwindcssAnimate]
};

export default config;
