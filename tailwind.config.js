/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5dae3",
          300: "#b0bacc",
          400: "#8695b0",
          500: "#68789a",
          600: "#526185",
          700: "#434e6c",
          800: "#394259",
          900: "#333a4b",
          950: "#222735",
        },
        brand: {
          50: "#eefdf8",
          100: "#cff9ec",
          200: "#a4f2dc",
          300: "#6be6c8",
          400: "#33cfb0",
          500: "#12b394",
          600: "#069177",
          700: "#0a7462",
          800: "#0d5b4f",
          900: "#0e4b42",
          950: "#032c28",
        },
        clay: {
          50: "#fdf7f3",
          100: "#faece2",
          200: "#f4d5c2",
          300: "#ecb498",
          400: "#e28d69",
          500: "#dc6f47",
          600: "#d4552f",
          700: "#b03e20",
          800: "#8e341e",
          900: "#742d1c",
          950: "#3e130a",
        },
      },
      fontFamily: {
        sans: [
          "Inter var",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: ["Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(34,39,53,.04), 0 8px 24px -12px rgba(34,39,53,.18)",
        lift: "0 2px 4px rgba(34,39,53,.05), 0 18px 40px -18px rgba(34,39,53,.32)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "sheet-in": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .5s cubic-bezier(.22,.9,.3,1) both",
        "sheet-in": "sheet-in .28s cubic-bezier(.22,.9,.3,1) both",
      },
    },
  },
  plugins: [],
};
