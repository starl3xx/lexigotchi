/**
 * The RainbowKit connect modal, dressed as a Lexigotchi cel: aged-paper cream, warm ink outline,
 * the hard offset shadow, Söhne, and candy red for the one action that matters.
 *
 * RainbowKit draws a 1px `modalBorder`, and its theme has no border-width token. The house `.cel`
 * outline is 3px, so the other 2px come from a zero-blur box-shadow ring (`0 0 0 2px`). The offset
 * shadow then grows by the same 2px spread, so it sits flush against the ring as `.cel`'s does.
 *
 * Colors mirror tailwind.config.ts. They are literals because the theme is a JS object that
 * RainbowKit writes into CSS variables, and Tailwind's theme() is only available inside CSS.
 */
import { lightTheme, type Theme } from "@rainbow-me/rainbowkit";

const PAPER = "#f4ead2";
const PAPER_DARK = "#e7d7b0";
const INK = "#1b1714";
const CANDY = "#d8463f";

const base = lightTheme({
  accentColor: CANDY,
  accentColorForeground: PAPER,
  borderRadius: "large",
  overlayBlur: "small",
});

export const walletTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    modalBackground: PAPER,
    modalBackdrop: "rgba(27, 23, 20, 0.45)",
    modalBorder: INK,
    modalText: INK,
    modalTextSecondary: "rgba(27, 23, 20, 0.6)",
    modalTextDim: "rgba(27, 23, 20, 0.35)",
    actionButtonSecondaryBackground: PAPER_DARK,
    closeButton: INK,
    closeButtonBackground: PAPER_DARK,
    menuItemBackground: PAPER_DARK,
    generalBorder: "rgba(27, 23, 20, 0.15)",
    generalBorderDim: "rgba(27, 23, 20, 0.08)",
    profileAction: PAPER_DARK,
    profileActionHover: "#dccb9f",
    profileForeground: PAPER,
    selectedOptionBorder: INK,
    connectButtonBackground: PAPER,
    connectButtonInnerBackground: PAPER_DARK,
    connectButtonText: INK,
  },
  fonts: {
    body: 'var(--font-body), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  shadows: {
    ...base.shadows,
    dialog: `0 0 0 2px ${INK}, 6px 6px 0 2px ${INK}`,
    profileDetailsAction: "none",
    selectedOption: "none",
    selectedWallet: "none",
  },
};
