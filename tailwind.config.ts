import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        // Plexus brand palette — anchored to the CSS variables defined in
        // client/src/index.css. Use these in shared shell / header / nav
        // surfaces; product UI continues to use the semantic tokens
        // (primary, ring, accent, sidebar-*) which already alias here.
        plexus: {
          ice:        "hsl(var(--plexus-ice) / <alpha-value>)",
          "blue-300": "hsl(var(--plexus-blue-300) / <alpha-value>)",
          "blue-500": "hsl(var(--plexus-blue-500) / <alpha-value>)",
          "blue-600": "hsl(var(--plexus-blue-600) / <alpha-value>)",
          "blue-800": "hsl(var(--plexus-blue-800) / <alpha-value>)",
          "navy-700": "hsl(var(--plexus-navy-700) / <alpha-value>)",
          "navy-800": "hsl(var(--plexus-navy-800) / <alpha-value>)",
          "navy-950": "hsl(var(--plexus-navy-950) / <alpha-value>)",
        },
        // Soft-finance design system — Apple-like SaaS dashboard surface.
        // Available as bg-finance-bg, text-finance-text, border-finance-
        // border, etc. CSS vars are defined in client/src/index.css.
        finance: {
          bg:                "hsl(var(--finance-bg) / <alpha-value>)",
          "bg-soft":         "hsl(var(--finance-bg-soft) / <alpha-value>)",
          "bg-bright":       "hsl(var(--finance-bg-bright) / <alpha-value>)",
          card:              "hsl(var(--finance-card) / <alpha-value>)",
          "card-soft":       "hsl(var(--finance-card-soft) / <alpha-value>)",
          "card-strong":     "hsl(var(--finance-card-strong) / <alpha-value>)",
          border:            "hsl(var(--finance-border) / <alpha-value>)",
          "border-strong":   "hsl(var(--finance-border-strong) / <alpha-value>)",
          text:              "hsl(var(--finance-text) / <alpha-value>)",
          "text-secondary":  "hsl(var(--finance-text-secondary) / <alpha-value>)",
          "text-muted":      "hsl(var(--finance-text-muted) / <alpha-value>)",
          dark:              "hsl(var(--finance-dark) / <alpha-value>)",
          "dark-2":          "hsl(var(--finance-dark-2) / <alpha-value>)",
          "dark-3":          "hsl(var(--finance-dark-3) / <alpha-value>)",
          periwinkle:        "hsl(var(--finance-periwinkle) / <alpha-value>)",
          "blue-soft":       "hsl(var(--finance-blue-soft) / <alpha-value>)",
          "lavender-soft":   "hsl(var(--finance-lavender-soft) / <alpha-value>)",
          "green-soft":      "hsl(var(--finance-green-soft) / <alpha-value>)",
          "sand-soft":       "hsl(var(--finance-sand-soft) / <alpha-value>)",
          "pink-soft":       "hsl(var(--finance-pink-soft) / <alpha-value>)",
          "cta-blue":        "hsl(var(--finance-cta-blue) / <alpha-value>)",
          "cta-sand":        "hsl(var(--finance-cta-sand) / <alpha-value>)",
          "cta-green":       "hsl(var(--finance-cta-green) / <alpha-value>)",
          "cta-lavender":    "hsl(var(--finance-cta-lavender) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
