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
 * The kinds of update a note can be, each with the words its heading may use (starl3xx: an update
 * "need[s] to include what kind of update [it is]"). A post opens with its kind's label. The labels
 * are fixed text, never the heading's own words, so they need no escaping and can't break Telegram's
 * HTML.
 * @type {Map<string, { emoji: string, label: string, words: string[] }>}
 */
export const KINDS = new Map([
  ["new", { emoji: "🆕", label: "New feature", words: ["new", "new feature", "feature"] }],
  ["fix", { emoji: "🐛", label: "Bug fix", words: ["fix", "bug fix", "bugfix", "bug"] }],
  ["qol", { emoji: "✨", label: "Quality of life", words: ["qol", "quality of life", "polish", "improvement"] }],
  ["change", { emoji: "🔄", label: "Change", words: ["change", "balance", "balance change", "rule change"] }],
  ["heads-up", { emoji: "⚠️", label: "Heads up", words: ["heads up", "headsup", "notice"] }],
]);
// A note whose heading names no kind, or one not listed above, still posts: under this label. A note
// that didn't post would be tried again on every deploy.
const UPDATE = { emoji: "📣", label: "Update" };

/**
 * The kind a heading's words name ("(fix)", ": Bug fix", "- QOL update"), or null.
 * @param {string} words
 */
function kindOf(words) {
  const said = words.toLowerCase().replace(/[^a-z]+/g, " ").trim().replace(/ update$/, "");
  for (const [kind, { words: names }] of KINDS) if (names.includes(said)) return kind;
  return null;
}

// "## Tester note", and after it, the kind: "## Tester note (fix)". Not "## Tester notes".
const HEADING = /^#{2,3}\s*tester note\b(.*)$/i;

/**
 * The "## Tester note" section of a PR description: everything under that heading, up to the next
 * heading, a horizontal rule (---, * * *, ___), or the "🤖 Generated with …" line that ends our PR
 * descriptions, and the kind of update its heading names (null for none, or one not in KINDS).
 * Null when there is no section, or it says "none", "n/a", or "-".
 * @param {string | null | undefined} text
 * @returns {{ kind: string | null, note: string } | null}
 */
export function testerNote(text) {
  const lines = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(#{1,6}\s|([-*_])( *\2){2,}$|🤖)/u.test(l.trim()));
  const note = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  if (!note || /^(none|n\/a|-)$/i.test(note)) return null;
  return { kind: kindOf(HEADING.exec(lines[start].trim())?.[1] ?? ""), note };
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
 * The posts for one or more notes (as `testerNote` gives them; a bare string is a note of no named
 * kind), oldest first. Each has `html` to send with parse_mode HTML, `text`, the same post as typed,
 * for when Telegram refuses the HTML, and `notes`, the indexes of the notes it carries (so their PRs
 * can be labelled as soon as it is sent).
 *
 * Every note opens with its kind: a single note under a line of its own ("🐛 Bug fix"), keeping its
 * line breaks; several in one post, when they fit, as one bullet each ("• 🐛 Bug fix: …"). Each
 * note is converted on its own, so a stray ** in one can't pair with the next.
 * @param {({ kind: string | null, note: string } | string)[]} notes
 * @returns {{ html: string, text: string, notes: number[] }[]}
 */
export function betaPosts(notes) {
  const items = notes.map((n) => {
    const { kind, note } = typeof n === "string" ? { kind: null, note: n } : n;
    return { ...((kind && KINDS.get(kind)) || UPDATE), note: fit(note) };
  });
  /** @param {number[]} picked */
  const post = (picked) => {
    /**
     * @param {(note: string) => string} format
     * @param {(label: string) => string} strong
     */
    const body = (format, strong) => {
      if (picked.length === 1) {
        const { emoji, label, note } = items[picked[0]];
        return `${emoji} ${strong(label)}\n${format(note)}`;
      }
      return picked
        .map((i) => `• ${items[i].emoji} ${strong(`${items[i].label}:`)} ${format(items[i].note.replace(/\n+/g, " "))}`)
        .join("\n\n");
    };
    return {
      html: `${body(noteHtml, (label) => `<b>${label}</b>`)}\n\n${FOOTER}`,
      text: `${body((n) => n, (label) => label)}\n\n${FOOTER}`,
      notes: picked,
    };
  };
  const together = post(items.map((_, i) => i));
  // `text` is never shorter than what Telegram counts (it still has the markdown's own marks).
  return together.text.length <= MESSAGE_MAX ? [together] : items.map((_, i) => post([i]));
}
