import type { Config } from "tailwindcss";

/**
 * Lexigotchi brand palette — 1930s rubber-hose cartoon meets vintage Scrabble tile.
 * Aged-paper cream, ink black, candy red, a single trophy/UPPERCASE gold, and an
 * accent teal. Kept deliberately small so the art (not the chrome) carries the brand.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // `hover:` only where a real pointer hovers. On a phone a tap "hovers" too, and the style stuck
  // on the last thing tapped.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#f4ead2", // aged cartoon-cel cream
          dark: "#e7d7b0",
          ink: "#1b1714", // near-black warm ink for outlines
        },
        ink: "#1b1714",
        // Raised surfaces (cards, list tiles, ghost buttons, chips, inputs) sit a shade lighter than
        // the paper page, so a card reads as an object on the page rather than an outline on it.
        card: "#fbf4e3",
        // Each hue has a FILL (the base) and an INK shade for text. The base hues are too light for
        // small text: cream on teal measured 2.78:1 and teal text on paper 2.78:1, where small text
        // needs 4.5:1. The ink shades clear 4.5:1 on paper AND on the hue's own 20–30% tints (the
        // badges), so `text-<hue>-ink` is the one rule for colored text. `candy.deep` is the fill
        // for cream-labeled buttons (4.52:1); teal and gold buttons take ink labels instead.
        candy: {
          DEFAULT: "#d8463f", // rubber-hose candy red
          deep: "#bd3d35", // fill behind cream text (buttons, toasts)
          ink: "#9a2f29", // candy-colored text
        },
        teal: {
          DEFAULT: "#2a9d8f",
          ink: "#1a5e56", // teal-colored text
        },
        gold: {
          DEFAULT: "#e0a93b", // trophy / UPPERCASE glow-up
          deep: "#b07d20", // display numbers only (large text, 3:1); small gold text uses gold.ink
          ink: "#6f4e10", // gold-colored small text
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
        // A letter, or a card with letters on it, arriving: it drops in and settles. It never grows:
        // a tile's size does not change in any animation (decisions.md #48). `pop` below is for
        // things that are not letters (a toast, an icon).
        drop: {
          "0%": { transform: "translateY(-16px) rotate(-6deg)", opacity: "0" },
          "70%": { transform: "translateY(2px) rotate(1.5deg)", opacity: "1" },
          "100%": { transform: "translateY(0) rotate(0deg)", opacity: "1" },
        },
        // a pop for what is not a letter (a toast, an icon); never on a tile or on a box around one
        pop: {
          "0%": { transform: "scale(0.4) rotate(-12deg)", opacity: "0" },
          "70%": { transform: "scale(1.12) rotate(4deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        // --- TileCharacter (the letter review, decisions.md #28) ---
        // The loops below run on the character's LAYERS (whole <svg>s: the body, the legs), never on
        // a shape inside one, so a browser slides a finished picture instead of redrawing the letter
        // on every frame (TileCharacter's header has the numbers). Distances are in the drawing's
        // units through --ux / --uy (one unit as a percent of the layer's box, set by the tile), so
        // the motion is the same at every size. Feet stay planted: the legs layer stretches from
        // the feet while the body layer rises.
        // A TILE'S SIZE NEVER CHANGES (decisions.md #48; starl3xx: "however the tiles are animated,
        // their size should never change in animation; it breaks the character illusion"): a body
        // loop moves and turns the tile, and never scales it. The legs may stretch: that is what
        // keeps the feet down, and the tile itself stays the size it is. tests/tile-size.test.ts
        // holds it.
        // idle: a breath (it used to bounce 7 units every 1.5 s, in step, like a metronome)
        tcBreathe: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(calc(var(--uy) * -3))" },
        },
        tcLegBreathe: {
          "0%,100%": { transform: "scaleY(1)" },
          "50%": { transform: "scaleY(1.06)" },
        },
        // peckish: slower and shallower, sinking a little
        tcSigh: {
          "0%,100%": { transform: "translateY(calc(var(--uy) * 1))" },
          "45%": { transform: "translateY(calc(var(--uy) * -1.5))" },
        },
        tcLegSigh: {
          "0%,100%": { transform: "scaleY(0.98)" },
          "45%": { transform: "scaleY(1.03)" },
        },
        // hungry: asleep, a slow rock about the feet (it used to swell and shrink)
        tcSleep: {
          "0%,100%": { transform: "rotate(0deg)" },
          "50%": { transform: "rotate(-0.7deg) translateY(calc(var(--uy) * 0.8))" },
        },
        tcEat: {
          "0%,100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" },
        },
        // a raised letter: two hops, then it stands in its pose (it used to pulse 13% bigger). The
        // legs stretch by the body's rise over their own length (52 units), so the feet stay down.
        tcHop: {
          "0%": { transform: "translateY(0) rotate(0deg)", animationTimingFunction: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
          "14%": { transform: "translateY(calc(var(--uy) * -12)) rotate(-2deg)", animationTimingFunction: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
          "28%": { transform: "translateY(0) rotate(0deg)", animationTimingFunction: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
          "38%": { transform: "translateY(calc(var(--uy) * -5)) rotate(1.5deg)", animationTimingFunction: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
          "48%,100%": { transform: "translateY(0) rotate(0deg)" },
        },
        tcLegHop: {
          "0%": { transform: "scaleY(1)", animationTimingFunction: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
          "14%": { transform: "scaleY(1.23)", animationTimingFunction: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
          "28%": { transform: "scaleY(1)", animationTimingFunction: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
          "38%": { transform: "scaleY(1.096)", animationTimingFunction: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
          "48%,100%": { transform: "scaleY(1)" },
        },
        tcJump: {
          "0%,100%": { transform: "translateY(0) rotate(-1.5deg)" },
          "50%": { transform: "translateY(calc(var(--uy) * -15)) rotate(1.5deg)" },
        },
        tcLegJump: {
          "0%,100%": { transform: "scaleY(1)" },
          "50%": { transform: "scaleY(1.29)" },
        },
        // rolling: it can't look. The body trembles, the knees knock.
        tcBrace: {
          "0%,100%": { transform: "translate(calc(var(--ux) * -1.3), 0)" },
          "50%": { transform: "translate(calc(var(--ux) * 1.3), calc(var(--uy) * 0.6))" },
        },
        tcKnock: {
          "0%,100%": { transform: "skewX(-5deg)" },
          "50%": { transform: "skewX(5deg)" },
        },
        // a bead of sweat flicks off the brow, on a layer of its own (TileCharacter, SWEAT): it flies
        // 21 of the drawing's units along its own direction (--fx, --fy) and grows as it goes. The
        // distance is in units (--ux, --uy), so it is the same at every size.
        tcSweat: {
          "0%": { opacity: "0", transform: "translate(calc(var(--ux) * var(--fx) * -3), calc(var(--uy) * var(--fy) * -3)) scale(0.5)" },
          "18%,62%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translate(calc(var(--ux) * var(--fx) * 18), calc(var(--uy) * var(--fy) * 18)) scale(1)" },
        },
        // The peek runs INSIDE the body layer, for as long as a roll or an ascension try takes: its
        // two halves swap in steps, so nothing is redrawn between them (measured: no cost).
        // one eye peeks open for a moment, then screws shut again (the two swap, step-end)
        tcPeekOpen: {
          "0%": { opacity: "0" },
          "60%": { opacity: "1" },
          "82%,100%": { opacity: "0" },
        },
        tcPeekShut: {
          "0%": { opacity: "1" },
          "60%": { opacity: "0" },
          "82%,100%": { opacity: "1" },
        },
        tcConfetti: {
          // a piece of confetti is a small drawing of its own (TileCharacter, Confetti), so a percent
          // here is of the PIECE's box: it starts a little over its own height up, and falls
          // --tc-fall, which is most of the letter's visible height
          "0%": { opacity: "0", transform: "translateY(-133%) rotate(0)" },
          "12%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(var(--tc-fall, 1400%)) rotate(360deg)" },
        },
        tcRay: { to: { transform: "rotate(360deg)" } },
        // a sleeping letter's z, on a layer of its own (TileCharacter, ZS): it rises 16 of the drawing's
        // units and fades. The distance is in units (--uy), so it is the same at every size.
        tcZzz: {
          "0%": { opacity: "0", transform: "translateY(calc(var(--uy) * 2)) scale(0.8)" },
          "30%": { opacity: "1" },
          "100%": { opacity: "0", transform: "translateY(calc(var(--uy) * -14)) scale(1.1)" },
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
        drop: "drop 0.45s ease-out both",
        "tc-breathe": "tcBreathe 3.6s ease-in-out infinite",
        "tc-legbreathe": "tcLegBreathe 3.6s ease-in-out infinite",
        "tc-sigh": "tcSigh 5.2s ease-in-out infinite",
        "tc-legsigh": "tcLegSigh 5.2s ease-in-out infinite",
        "tc-sleep": "tcSleep 5.6s ease-in-out infinite",
        "tc-eat": "tcEat 0.5s ease-in-out infinite",
        "tc-hop": "tcHop 1.7s linear infinite",
        "tc-leghop": "tcLegHop 1.7s linear infinite",
        "tc-jump": "tcJump 0.75s ease-in-out infinite",
        "tc-legjump": "tcLegJump 0.75s ease-in-out infinite",
        "tc-brace": "tcBrace 0.17s linear infinite",
        "tc-knock": "tcKnock 0.34s ease-in-out infinite",
        "tc-sweat": "tcSweat 1.5s ease-out infinite",
        "tc-peek-open": "tcPeekOpen 3.2s step-end infinite",
        "tc-peek-shut": "tcPeekShut 3.2s step-end infinite",
        "tc-confetti": "tcConfetti 1.5s linear infinite",
        "tc-ray": "tcRay 18s linear infinite",
        "tc-zzz": "tcZzz 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
