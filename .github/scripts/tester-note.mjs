// The text of a beta-updates post (.github/workflows/beta-updates.yml): a PR's "## Tester note",
// and the Telegram message built from one or more of them.
//
// Plain JavaScript, no imports, so the workflow can load it with nothing installed; the tests in
// tests/tester-note.test.ts import the same file.
//
// Telegram shows a message's text as typed unless it is sent with a parse_mode, so a note's
// **bold** arrived with its asterisks. We convert the note's markdown to Telegram's HTML mode rather
// than use its Markdown modes: MarkdownV2 makes every "." "!" "-" "(" in the text an error unless it
// is escaped, and the old Markdown mode fails on a lone "_". HTML needs only & < > escaped.

/**
 * The "## Tester note" section of a PR description: everything under that heading, up to the next
 * heading, a horizontal rule, or the "🤖 Generated with …" line that ends our PR descriptions.
 * Null when there is none, or it says "none", "n/a", or "-".
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function testerNote(text) {
  const lines = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s*tester note\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(#{1,6}\s|-{3,}$|\*{3,}$|🤖)/u.test(l.trim()));
  const note = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return !note || /^(none|n\/a|-)$/i.test(note) ? null : note;
}

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A note's markdown as Telegram HTML. Three kinds only, the ones that can't nest wrongly:
 * `code`, [text](https://link), and **bold**. Anything else (a lone **, single-star italics,
 * snake_case) stays as typed. Code spans come out first, so nothing inside one is formatted.
 * @param {string} markdown
 */
export function noteHtml(markdown) {
  return markdown
    .split(/(`[^`\n]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeHtml(part)
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`)
        .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<b>$1</b>");
    })
    .join("");
}

const FOOTER = "Live now at lexigotchi.fun/play";

/**
 * The post for one or more notes, oldest first: `html` to send with parse_mode HTML, and `text`,
 * the same post as typed, for when Telegram refuses the HTML. Several notes become one bullet
 * each, and each note is converted on its own, so a stray ** in one can't pair with the next.
 * @param {string[]} notes
 * @returns {{ html: string, text: string }}
 */
export function betaPost(notes) {
  /** @param {(note: string) => string} format */
  const body = (format) =>
    notes.length === 1 ? format(notes[0]) : notes.map((n) => `• ${format(n.replace(/\n+/g, " "))}`).join("\n\n");
  return { html: `${body(noteHtml)}\n\n${FOOTER}`, text: `${body((n) => n)}\n\n${FOOTER}` };
}
