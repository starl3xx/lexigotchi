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
          bright: "#f0a617", // spec gold — gild pips / crown / sparkles
        },
        tile: "#e8c98a", // Scrabble-tile wood (legacy flat tile)
        // --- TileCharacter (vaudeville tile) palette — spec §2, added additively ---
        tileFace: "#f8efdd", // lowercase tile face (warm cream "wood")
        edgeWood: "#c7ae84", // lowercase tile bottom edge (3-D shelf)
        night: "#1f3a4d", // dark / "stage" scene background
        curtain: "#7b1e26", // snack, "?" mark, jewel accents
        brass: "#c8962b", // gilded ring (primary gold)
        billiard: "#3e5c3a", // "fed" status accents
        sheen: "#fce8a8", // pale-gold gild sheen hairline
        twinkle: "#fff6dd", // sparkle glint fill
        lhaw: {
          DEFAULT: "#3b82f6", // UPPERCASE = the Let's Have A Word! input tile (blue-500)
          ring: "#bbd1fd", // outer pale-blue ring
          ink: "#111827", // UPPERCASE printed letter (gray-900)
        },
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
        // --- TileCharacter states (spec §5). Feet stay planted: legs scaleY, body translateY. ---
        tcIdle: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-7px)" },
        },
        tcLegBob: {
          "0%,100%": { transform: "scaleY(1)" },
          "50%": { transform: "scaleY(1.11)" },
        },
        tcBobSlow: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        tcRoll: {
          "0%,100%": { transform: "translate(0,0)" },
          "25%": { transform: "translate(-2.5px,1px)" },
          "75%": { transform: "translate(2.5px,-1px)" },
        },
        tcEat: {
          "0%,100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" },
        },
        tcPop: {
          "0%,100%": { transform: "scale(1)" },
          "45%": { transform: "scale(1.13)" },
          "70%": { transform: "scale(0.97)" },
        },
        tcJump: {
          "0%,100%": { transform: "translateY(0) rotate(-1.5deg)" },
          "50%": { transform: "translateY(-15px) rotate(1.5deg)" },
        },
        tcConfetti: {
          "0%": { opacity: "0", transform: "translateY(-16px) rotate(0)" },
          "12%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(82px) rotate(360deg)" },
        },
        tcRay: { to: { transform: "rotate(360deg)" } },
        tcTwinkle: {
          "0%,100%": { transform: "scale(0.5) rotate(0deg)", opacity: "0.35" },
          "50%": { transform: "scale(1.15) rotate(35deg)", opacity: "1" },
        },
        tcDart: {
          "0%,100%": { transform: "translateX(-2px)" },
          "50%": { transform: "translateX(2px)" },
        },
        tcZzz: {
          "0%": { opacity: "0", transform: "translateY(2px) scale(0.8)" },
          "30%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(-14px) scale(1.1)" },
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
        "tc-idle": "tcIdle 1.5s ease-in-out infinite",
        "tc-legbob": "tcLegBob 1.5s ease-in-out infinite",
        "tc-bobslow": "tcBobSlow 2.6s ease-in-out infinite",
        "tc-roll": "tcRoll 0.24s ease-in-out infinite",
        "tc-eat": "tcEat 0.5s ease-in-out infinite",
        "tc-pop": "tcPop 0.9s ease-in-out infinite",
        "tc-jump": "tcJump 0.75s ease-in-out infinite",
        "tc-confetti": "tcConfetti 1.5s linear infinite",
        "tc-ray": "tcRay 7s linear infinite",
        "tc-twinkle": "tcTwinkle 1.8s ease-in-out infinite",
        "tc-dart": "tcDart 0.9s ease-in-out infinite",
        "tc-zzz": "tcZzz 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
