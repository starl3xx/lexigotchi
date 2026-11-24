// The text of a beta-updates post (.github/workflows/beta-updates.yml): a PR's "## Tester note",
// and the Telegram messages built from one or more of them.
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
 * heading, a horizontal rule (---, * * *, ___), or the "🤖 Generated with …" line that ends our PR
 * descriptions. Null when there is none, or it says "none", "n/a", or "-".
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function testerNote(text) {
  const lines = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s*tester note\s*$/i.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(#{1,6}\s|([-*_])( *\2){2,}$|🤖)/u.test(l.trim()));
  const note = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return !note || /^(none|n\/a|-)$/i.test(note) ? null : note;
}

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// [label](https://address). The address may hold balanced brackets, as Wikipedia's do.
const LINK = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;
// **bold**: not inside a word (so 2**3 stays maths), may wrap onto a second line, never across a
// blank one.
const BOLD = /(?<![\w*])\*\*(?=\S)((?:[^\n]|\n(?!\n))*?\S)\*\*(?![\w*])/g;
// A code span or a link set aside while the rest is formatted: its number between two private-use
// characters, one pair for code and one for links. They are removed from the note first, so a note
// can't fake one.
const [CODE_IN, CODE_OUT, LINK_IN, LINK_OUT] = [0xe000, 0xe001, 0xe002, 0xe003].map((c) => String.fromCharCode(c));
const MARKS = new RegExp(`[${CODE_IN}${CODE_OUT}${LINK_IN}${LINK_OUT}]`, "g");
const CODE_SLOT = new RegExp(`${CODE_IN}([0-9]+)${CODE_OUT}`, "g");
const LINK_SLOT = new RegExp(`${LINK_IN}([0-9]+)${LINK_OUT}`, "g");

/**
 * A note's markdown as Telegram HTML. Three kinds only: `code`, [text](https://link), and **bold**.
 * Anything else (a lone **, single-star italics, snake_case, ``` fences) stays as typed.
 *
 * Code spans are set aside first, then links, so the bold pass never reaches into a code span or a
 * link's address. Telegram lets bold and links hold each other, but nothing may hold code (it
 * refuses such a message): so bold stops either side of a code span, and a code span inside a
 * link's label shows as plain text.
 * @param {string} markdown
 */
export function noteHtml(markdown) {
  /** @type {string[]} */
  const codes = []; // each code span's text, escaped
  /** @type {string[]} */
  const links = []; // each link, as finished HTML
  /**
   * @param {string} s
   * @param {(code: string) => string} as
   */
  const restoreCode = (s, as) => s.replace(CODE_SLOT, (_, i) => as(codes[Number(i)]));
  /**
   * @param {string} s
   * @param {boolean} stopAtCode
   */
  const bold = (s, stopAtCode) =>
    s.replace(BOLD, (_, inner) => `<b>${stopAtCode ? inner.replace(CODE_SLOT, (slot) => `</b>${slot}<b>`) : inner}</b>`.replace(/<b><\/b>/g, ""));

  const note = markdown
    .replace(MARKS, "")
    .replace(/`([^`\n]+)`/g, (_, code) => `${CODE_IN}${codes.push(escapeHtml(code)) - 1}${CODE_OUT}`)
    .replace(LINK, (link, label, url) => {
      // An address with a code span in it isn't one: leave that link as typed.
      if (url.includes(CODE_IN)) return link;
      const html = `<a href="${escapeHtml(url).replace(/"/g, "&quot;")}">${restoreCode(bold(escapeHtml(label), false), (code) => code)}</a>`;
      return `${LINK_IN}${links.push(html) - 1}${LINK_OUT}`;
    });
  const formatted = bold(escapeHtml(note), true).replace(LINK_SLOT, (_, i) => links[Number(i)]);
  return restoreCode(formatted, (code) => `<code>${code}</code>`);
}

const FOOTER = "Live now at lexigotchi.fun/play";
// Telegram refuses a message over 4,096 characters, and a refused post is never labelled, so it
// would be tried again on every deploy. A note is cut to fit; notes that don't fit together go out
// one by one.
const MESSAGE_MAX = 4096;
const NOTE_MAX = 3500;

/**
 * The note, cut to NOTE_MAX UTF-16 units (the count Telegram's limit may use, and never fewer than
 * the characters), and never in the middle of an emoji.
 * @param {string} note
 */
function fit(note) {
  if (note.length <= NOTE_MAX) return note;
  let cut = "";
  for (const ch of note) {
    if (cut.length + ch.length > NOTE_MAX) break;
    cut += ch;
  }
  return `${cut.trimEnd()}…`;
}

/**
 * The posts for one or more notes, oldest first. Each has `html` to send with parse_mode HTML,
 * `text`, the same post as typed, for when Telegram refuses the HTML, and `notes`, the indexes of
 * the notes it carries (so their PRs can be labelled as soon as it is sent).
 *
 * All the notes go in one post when they fit, as one bullet each (a single note keeps its line
 * breaks). Each note is converted on its own, so a stray ** in one can't pair with the next.
 * @param {string[]} notes
 * @returns {{ html: string, text: string, notes: number[] }[]}
 */
export function betaPosts(notes) {
  const fitted = notes.map(fit);
  /** @param {number[]} picked */
  const post = (picked) => {
    /** @param {(note: string) => string} format */
    const body = (format) =>
      picked.length === 1 ? format(fitted[picked[0]]) : picked.map((i) => `• ${format(fitted[i].replace(/\n+/g, " "))}`).join("\n\n");
    return { html: `${body(noteHtml)}\n\n${FOOTER}`, text: `${body((n) => n)}\n\n${FOOTER}`, notes: picked };
  };
  const together = post(fitted.map((_, i) => i));
  // `text` is never shorter than what Telegram counts (it still has the markdown's own marks).
  return together.text.length <= MESSAGE_MAX ? [together] : fitted.map((_, i) => post([i]));
}
