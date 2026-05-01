/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          50: "#f5f7fb",
          100: "#e6ebf3",
          200: "#c6cfe0",
          300: "#94a1bd",
          400: "#6473a0",
          500: "#3f4c7a",
          600: "#28335a",
          700: "#1a2347",
          800: "#10173a",
          900: "#080d28",
          950: "#04081a",
        },
        accent: {
          cyan: "#00f0ff",
          violet: "#a78bfa",
          pink: "#f472b6",
          lime: "#a3e635",
          amber: "#fbbf24",
        },
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse at top, rgba(167,139,250,0.18), transparent 55%), radial-gradient(ellipse at bottom right, rgba(0,240,255,0.10), transparent 55%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px -8px rgba(0,240,255,0.25)",
        glowViolet:
          "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px -8px rgba(167,139,250,0.35)",
      },
      animation: {
        shimmer: "shimmer 2s linear infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
