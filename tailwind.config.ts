import type { Config } from "tailwindcss";

/**
 * Lexigotchi brand palette — 1930s rubber-hose cartoon meets vintage Scrabble tile.
 * Aged-paper cream, ink black, candy red, a single trophy/UPPERCASE gold, and an
 * accent teal. Kept deliberately small so the art (not the chrome) carries the brand.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#f4ead2", // aged cartoon-cel cream
          dark: "#e7d7b0",
          ink: "#1b1714", // near-black warm ink for outlines
        },
        ink: "#1b1714",
        candy: "#d8463f", // rubber-hose candy red
        teal: "#2a9d8f",
        gold: {
          DEFAULT: "#e0a93b", // trophy / UPPERCASE glow-up
          deep: "#b07d20",
        },
        tile: "#e8c98a", // Scrabble-tile wood
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      keyframes: {
        // Shared rubber-hose "rig" animation states (CSS fallback before Rive in Phase 3).
        // Squash-and-stretch is exaggerated (with horizontal "breathing") for cartoon
        // elasticity; pair with transform-origin: bottom so characters plant their feet.
        idle: {
          "0%,100%": { transform: "translateY(0) scaleY(0.99) scaleX(1.01) rotate(0deg)" },
          "50%": { transform: "translateY(-7px) scaleY(1.05) scaleX(0.96) rotate(-1.5deg)" },
        },
        droop: {
          "0%,100%": { transform: "translateY(2px) scaleX(1.03) scaleY(0.95) rotate(0.5deg)" },
          "50%": { transform: "translateY(5px) scaleX(1.05) scaleY(0.92) rotate(-0.5deg)" },
        },
        slump: {
          "0%,100%": { transform: "translateY(7px) scaleX(1.06) scaleY(0.8) rotate(0deg)" },
          "50%": { transform: "translateY(9px) scaleX(1.08) scaleY(0.75) rotate(0deg)" },
        },
        shiver: {
          "0%,100%": { transform: "translateX(-1.5px) rotate(-1.5deg)" },
          "50%": { transform: "translateX(1.5px) rotate(1.5deg)" },
        },
        "happy-dance": {
          "0%,100%": { transform: "translateY(0) rotate(-5deg)" },
          "25%": { transform: "translateY(-18px) rotate(12deg)" },
          "50%": { transform: "translateY(-8px) rotate(-12deg)" },
          "75%": { transform: "translateY(-16px) rotate(6deg)" },
        },
        blink: {
          "0%,92%,100%": { transform: "scaleY(1)" },
          "96%": { transform: "scaleY(0.1)" },
        },
        // Chorus-line choreography (spec §7): lowercase words shuffle, UPPERCASE kick.
        shuffle: {
          "0%,100%": { transform: "translateX(-5px) rotate(-1deg)" },
          "50%": { transform: "translateX(5px) rotate(1deg)" },
        },
        kick: {
          "0%,100%": { transform: "translateY(0) scaleY(1)" },
          "30%": { transform: "translateY(-12px) scaleY(1.06)" },
          "60%": { transform: "translateY(0) scaleY(0.94)" },
        },
        // reveal pop for pack/roll outcomes
        pop: {
          "0%": { transform: "scale(0.4) rotate(-12deg)", opacity: "0" },
          "70%": { transform: "scale(1.12) rotate(4deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        sheen: {
          "0%": { transform: "translateX(-120%) skewX(-20deg)" },
          "100%": { transform: "translateX(220%) skewX(-20deg)" },
        },
      },
      animation: {
        idle: "idle 2.8s ease-in-out infinite",
        droop: "droop 3.6s ease-in-out infinite",
        slump: "slump 4.5s ease-in-out infinite",
        shiver: "shiver 0.16s linear infinite",
        "happy-dance": "happy-dance 0.6s ease-in-out infinite",
        blink: "blink 2.5s linear infinite",
        shuffle: "shuffle 1.6s ease-in-out infinite",
        kick: "kick 0.9s ease-in-out infinite",
        pop: "pop 0.45s ease-out both",
        sheen: "sheen 1.1s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
