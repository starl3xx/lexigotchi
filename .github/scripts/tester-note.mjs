// The text of a beta-updates post (.github/workflows/beta-updates.yml): a PR's "## Tester note",
// and the Telegram messages built from one or more of them. Also a PR's "## Tester poll", which
// goes out under its note, and the weekly poll (.github/workflows/beta-pulse.yml).
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
 *
 * `rule` is the line of hyphens under the label (starl3xx: "the length of the type above it"): as
 * many as make it about as wide as the emoji and the bold label in SF Pro, the font Telegram uses on
 * Apple devices (Roboto, on Android, is within one). Counting the label's characters instead leaves
 * the line short, since a hyphen is narrower than most letters. Measure again if a label changes.
 * @type {Map<string, { emoji: string, label: string, rule: number, words: string[] }>}
 */
export const KINDS = new Map([
  ["new", { emoji: "🆕", label: "New feature", rule: 16, words: ["new", "new feature", "feature"] }],
  ["fix", { emoji: "🐛", label: "Bug fix", rule: 11, words: ["fix", "bug fix", "bugfix", "bug"] }],
  ["qol", { emoji: "✨", label: "Quality of life", rule: 17, words: ["qol", "quality of life", "polish", "improvement"] }],
  ["change", { emoji: "🔄", label: "Change", rule: 11, words: ["change", "balance", "balance change", "rule change"] }],
  ["heads-up", { emoji: "⚠️", label: "Heads up", rule: 13, words: ["heads up", "headsup", "notice"] }],
]);
// A note whose heading names no kind, or one not listed above, still posts: under this label. A note
// that didn't post would be tried again on every deploy.
export const UPDATE = { emoji: "📣", label: "Update", rule: 11 };

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
 * heading, a horizontal rule (---, * * *, ___), a code fence (``` or ~~~), or the "🤖 Generated with …"
 * line that ends our PR descriptions, and the kind of update its heading names (null for none, or one
 * not in KINDS). A note is a sentence or two in player language, never code: a fence means the
 * writer's own notes started (#208 posted its diagram and file list to the testers that way).
 * Null when there is no section, or it says "none", "n/a", or "-".
 * @param {string | null | undefined} text
 * @returns {{ kind: string | null, note: string } | null}
 */
export function testerNote(text) {
  const section = sectionUnder(text, HEADING);
  if (!section || /^(none|n\/a|-)$/i.test(section.body)) return null;
  return { kind: kindOf(section.words), note: section.body };
}

/**
 * A section of a PR description: the words after its heading's name ("(fix)"), and everything
 * under the heading up to the next heading, a horizontal rule, a code fence, or the
 * "🤖 Generated with …" line. Null when there is no such heading, or nothing under it.
 *
 * A heading inside a code fence is not one: a PR that SHOWS how to write a section (this file's
 * own PRs do) must not have its example posted to the testers.
 * @param {string | null | undefined} text
 * @param {RegExp} heading  matches the heading line; its first group is the words after the name
 * @returns {{ words: string, body: string } | null}
 */
function sectionUnder(text, heading) {
  const lines = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  let fenced = false;
  const start = lines.findIndex((l) => {
    if (/^(```|~~~)/.test(l.trim())) fenced = !fenced;
    return !fenced && heading.test(l.trim());
  });
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^(#{1,6}\s|([-*_])( *\2){2,}$|```|~~~|🤖)/u.test(l.trim()));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body ? { words: heading.exec(lines[start].trim())?.[1] ?? "", body } : null;
}

// Telegram's limits for a poll (Bot API, sendPoll): a question of 1 to 300 characters, and up to 12
// answers of 1 to 100 characters each. Telegram takes a single answer; a poll needs two to ask anything.
const QUESTION_MAX = 300;
const OPTION_MAX = 100;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 12;

/**
 * A poll's text as Telegram shows it: plain. A poll's question and answers take no formatting, so
 * **bold**, `code`, and [links](https://…) are written as their words.
 * @param {string} s
 */
const plain = (s) =>
  s
    .replace(/\[([^\]\n]+)\]\((?:[^\s()]|\([^\s()]*\))+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Why a poll can't be sent, or null when it can. One check for a PR's poll and the weekly one.
 * @param {string} question
 * @param {readonly string[]} options
 */
export function pollProblem(question, options) {
  if (!question) return "it has no question above its answers";
  if (question.length > QUESTION_MAX) return `its question is ${question.length} characters (Telegram takes ${QUESTION_MAX})`;
  if (options.length < OPTIONS_MIN) return `it has ${options.length === 1 ? "1 answer" : `${options.length} answers`} (write each as a list item; a poll needs at least ${OPTIONS_MIN})`;
  if (options.length > OPTIONS_MAX) return `it has ${options.length} answers (Telegram takes ${OPTIONS_MAX})`;
  const long = options.find((o) => o.length > OPTION_MAX);
  if (long) return `the answer "${long.slice(0, 30)}…" is ${long.length} characters (Telegram takes ${OPTION_MAX})`;
  if (options.some((o) => !o)) return "one of its answers is empty";
  if (new Set(options.map((o) => o.toLowerCase())).size < options.length) return "two of its answers are the same";
  return null;
}

// "## Tester poll", and after it, how it is asked: "## Tester poll (named)". Not "## Tester polls".
const POLL_HEADING = /^#{2,3}\s*tester poll\b(.*)$/i;
// An answer: a list item ("- Yes", "* Yes", "1. Yes"), with or without a task box ("- [ ] Yes").
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

/**
 * The "## Tester poll" section of a PR description: a question for the beta testers, then its
 * answers as a list. It goes out as a Telegram poll under the PR's tester note (no note, no poll).
 *
 *   ## Tester poll
 *
 *   Did **Roll again** work for you?
 *   - Yes
 *   - No
 *   - I haven't tried it
 *
 * Everything before the first list item is the question; each list item is an answer; anything
 * after the list is left out. Votes are anonymous unless the heading says "(named)" (the group then
 * sees who chose what). "(multiple)" lets a tester pick more than one answer: "(named, multiple)".
 *
 * Null when there is no section. `{ ok: false, why }` for one Telegram would refuse, so the
 * workflow can say why instead of posting nothing in silence.
 * @param {string | null | undefined} text
 * @returns {{ ok: true, question: string, options: string[], named: boolean, multiple: boolean } | { ok: false, why: string } | null}
 */
export function testerPoll(text) {
  const section = sectionUnder(text, POLL_HEADING);
  if (!section || /^(none|n\/a|-)$/i.test(section.body)) return null;
  const lines = section.body.split("\n");
  const first = lines.findIndex((l) => LIST_ITEM.test(l));
  const question = plain((first < 0 ? lines : lines.slice(0, first)).join(" "));
  const options = [];
  if (first >= 0) {
    for (const l of lines.slice(first)) {
      const item = LIST_ITEM.exec(l);
      // The list ends at the first line that isn't an item (a blank line between items is fine).
      if (!item && l.trim()) break;
      if (item) options.push(plain(item[1]));
    }
  }
  const why = pollProblem(question, options);
  if (why) return { ok: false, why };
  const said = section.words.toLowerCase();
  return { ok: true, question, options, named: /\b(named|public)\b/.test(said), multiple: /\b(multiple|multi|any)\b/.test(said) };
}

/**
 * The weekly poll (.github/workflows/beta-pulse.yml): one question, the same every week, so the
 * answers can be compared from week to week. Anonymous, so a tester can say it was frustrating.
 */
export const PULSE_POLL = Object.freeze({
  question: "How was Lexigotchi this week?",
  options: Object.freeze(["Loved it", "Good", "It was OK", "Frustrating", "I didn’t play"]),
});

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
 * The notes are grouped by kind, in the order the kinds first appear. Each kind opens with its label
 * over a line of hyphens:
 *
 *   ✨ Quality of life
 *   -----------------
 *   The note.
 *
 * A kind with one note shows it as written, line breaks kept; one with several shows a bullet each,
 * on one line. Each note is converted on its own, so a stray ** in one can't pair with the next.
 * @param {({ kind: string | null, note: string } | string)[]} notes
 * @returns {{ html: string, text: string, notes: number[] }[]}
 */
export function betaPosts(notes) {
  const items = notes.map((n) => {
    const { kind, note } = typeof n === "string" ? { kind: null, note: n } : n;
    // Only the kinds listed: never a name off an object's prototype.
    return { kind: kind && KINDS.has(kind) ? kind : null, note: fit(note) };
  });
  /** @param {number[]} picked */
  const post = (picked) => {
    /** @type {Map<string | null, number[]>} */
    const groups = new Map();
    for (const i of picked) groups.set(items[i].kind, [...(groups.get(items[i].kind) ?? []), i]);
    /**
     * @param {(note: string) => string} format
     * @param {(label: string) => string} strong
     */
    const body = (format, strong) =>
      [...groups]
        .map(([kind, these]) => {
          const { emoji, label, rule } = (kind && KINDS.get(kind)) || UPDATE;
          const text =
            these.length === 1
              ? format(items[these[0]].note)
              : these.map((i) => `• ${format(items[i].note.replace(/\n+/g, " "))}`).join("\n\n");
          return `${emoji} ${strong(label)}\n${"-".repeat(rule)}\n${text}`;
        })
        .join("\n\n");
    return { html: body(noteHtml, (label) => `<b>${label}</b>`), text: body((n) => n, (label) => label), notes: picked };
  };
  const together = post(items.map((_, i) => i));
  // `text` is never shorter than what Telegram counts (it still has the markdown's own marks).
  return together.text.length <= MESSAGE_MAX ? [together] : items.map((_, i) => post([i]));
}
