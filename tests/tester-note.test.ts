import { describe, expect, it } from "vitest";
// The same file the "Beta updates" workflow loads (plain JavaScript, so it runs with nothing installed).
import { KINDS, PULSE_POLL, UPDATE, betaPosts, noteHtml, pollProblem, testerNote, testerPoll } from "../.github/scripts/tester-note.mjs";

// #160's note, as it was posted with its asterisks showing.
const PR_160 =
  "**New: your linked wallets count as one player.** The leaderboard adds them up into one row. Hunger warnings and \"daily letter ready\" reminders now cover all your wallets. You can also **move your letters** from one wallet to another: connect the wallet that holds them, open your profile, and tap **Move this wallet's letters**. The sending wallet needs a little Base Sepolia ETH for the fee. Staked words stay where they are.";

describe("finding a PR's tester note", () => {
  const body = (note: string) => `## Summary\n\nStuff.\n\n## Tester note\n\n${note}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`;

  it("takes the section up to the next heading, rule, or the Claude Code line", () => {
    expect(testerNote(body(PR_160))).toEqual({ kind: null, note: PR_160 });
    expect(testerNote("## Tester note\nOne.\n\n## Test plan\n- x")?.note).toBe("One.");
    for (const rule of ["---", "***", "___", "* * *", "- - -", "_ _ _"]) {
      expect(testerNote(`### Tester note\nOne.\n${rule}\ninternal notes`)?.note).toBe("One.");
    }
  });

  it("stops at a code fence: a note is sentences, never a diagram (#208 posted its file list)", () => {
    const pr208 = [
      "## Tester note (new)",
      "",
      "The Shop is open on the test network with one test item. Tap Get test USDC in your balance, buy the test item, and tell us if anything about paying felt off.",
      "",
      "```text",
      "before merging",
      "  1. migration 0016 has run in production",
      "```",
      "",
      "The code change is docs only, published with the switch:",
      "- `docs-site/contracts.mdx`: the Shop and Test USDC rows.",
      "",
      "## Evidence",
    ].join("\n");
    expect(testerNote(pr208)).toEqual({
      kind: "new",
      note: "The Shop is open on the test network with one test item. Tap Get test USDC in your balance, buy the test item, and tell us if anything about paying felt off.",
    });
    expect(testerNote("## Tester note\nOne.\n~~~\ncode\n~~~")?.note).toBe("One.");
    // `code` inside a sentence is still the note's own formatting, not a fence.
    expect(testerNote("## Tester note\nTap `Get test USDC`.\n\n## Evidence")?.note).toBe("Tap `Get test USDC`.");
  });

  it("has no note without the section, an empty one, or a “none”, whatever kind its heading names", () => {
    expect(testerNote("## Summary\nStuff.")).toBeNull();
    expect(testerNote(null)).toBeNull();
    expect(testerNote(body("None"))).toBeNull();
    expect(testerNote(body("n/a"))).toBeNull();
    expect(testerNote("## Tester note\n<!-- one or two sentences -->\n")).toBeNull();
    expect(testerNote("## Tester note (fix)\n\nNone")).toBeNull();
    expect(testerNote("## Tester note (new)\n<!-- one or two sentences -->\n")).toBeNull();
    expect(testerNote("## Tester notes\n\nOne.")).toBeNull();
  });

  it("reads the kind of update from the heading, in any of the ways it may be written", () => {
    const kindOf = (heading: string) => testerNote(`${heading}\n\nOne.`)?.kind;
    expect(kindOf("## Tester note (new)")).toBe("new");
    expect(kindOf("## Tester note: New feature")).toBe("new");
    expect(kindOf("## Tester note (fix)")).toBe("fix");
    expect(kindOf("## Tester note - Bug fix")).toBe("fix");
    expect(kindOf("### Tester note — bug-fix")).toBe("fix");
    expect(kindOf("## Tester note (QOL)")).toBe("qol");
    expect(kindOf("## Tester note: QOL update")).toBe("qol");
    expect(kindOf("## Tester note (quality of life)")).toBe("qol");
    expect(kindOf("## Tester note (balance change)")).toBe("change");
    expect(kindOf("## Tester note (heads-up)")).toBe("heads-up");
    expect(kindOf("## TESTER NOTE [Heads up]")).toBe("heads-up");
    // No kind, or one it doesn't know: still a note, posted as an Update.
    expect(kindOf("## Tester note")).toBeNull();
    expect(kindOf("## Tester note (wibble)")).toBeNull();
    expect(kindOf("## Tester note (update)")).toBeNull();
  });

  it("knows each kind by its own name and by every word listed for it", () => {
    for (const [kind, { words }] of KINDS) {
      expect(words).toContain(kind.replace("-", " "));
      for (const word of words) expect(testerNote(`## Tester note (${word})\n\nOne.`)?.kind).toBe(kind);
    }
  });
});

describe("a note's formatting for Telegram", () => {
  it("turns **bold** into bold, and leaves the rest of the sentence alone", () => {
    expect(noteHtml(PR_160)).toBe(
      "<b>New: your linked wallets count as one player.</b> The leaderboard adds them up into one row. Hunger warnings and \"daily letter ready\" reminders now cover all your wallets. You can also <b>move your letters</b> from one wallet to another: connect the wallet that holds them, open your profile, and tap <b>Move this wallet's letters</b>. The sending wallet needs a little Base Sepolia ETH for the fee. Staked words stay where they are.",
    );
  });

  it("escapes what Telegram's HTML reads as markup, everywhere", () => {
    expect(noteHtml("Rolls <45%> & **packs & <more>**")).toBe("Rolls &lt;45%&gt; &amp; <b>packs &amp; &lt;more&gt;</b>");
    expect(noteHtml("`a<b>&c`")).toBe("<code>a&lt;b&gt;&amp;c</code>");
  });

  it("turns `code` into code, with nothing formatted inside it", () => {
    expect(noteHtml("Type `**not bold**` & see")).toBe("Type <code>**not bold**</code> &amp; see");
  });

  it("turns https links into links, brackets in the address included", () => {
    expect(noteHtml("Read [the docs](https://lexigotchi.fun/docs?a=1&b=\"2\")."))
      .toBe('Read <a href="https://lexigotchi.fun/docs?a=1&amp;b=&quot;2&quot;">the docs</a>.');
    expect(noteHtml("See [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now"))
      .toBe('See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a> now');
    expect(noteHtml("[not a link](javascript:alert(1))")).toBe("[not a link](javascript:alert(1))");
  });

  it("never formats inside a link's address", () => {
    expect(noteHtml("[x](https://a.com/**b**)")).toBe('<a href="https://a.com/**b**">x</a>');
    expect(noteHtml("**go** [x](https://a.com/**b**) **now**")).toBe('<b>go</b> <a href="https://a.com/**b**">x</a> <b>now</b>');
  });

  it("lets bold and links hold each other", () => {
    expect(noteHtml("**Read [the docs](https://a.com) first**")).toBe('<b>Read <a href="https://a.com">the docs</a> first</b>');
    expect(noteHtml("[**Bold link**](https://a.com)")).toBe('<a href="https://a.com"><b>Bold link</b></a>');
  });

  it("never puts code inside bold or a link, which Telegram refuses (Bugbot on #162)", () => {
    // Bold stops either side of the code span.
    expect(noteHtml("**Tap `Move` now**")).toBe("<b>Tap </b><code>Move</code><b> now</b>");
    expect(noteHtml("**`Move` now**")).toBe("<code>Move</code><b> now</b>");
    // In a link's label, code shows as plain text, and bold around it stays whole.
    expect(noteHtml("[`code` label](https://a.com)")).toBe('<a href="https://a.com">code label</a>');
    expect(noteHtml("[**a `b` c**](https://a.com)")).toBe('<a href="https://a.com"><b>a b c</b></a>');
  });

  it("only ever nests the way Telegram allows", () => {
    // Telegram: bold and links may hold each other; nothing holds code; a link never holds a link.
    const nestsOk = (html: string) => {
      const open: string[] = [];
      for (const [, close, tag] of html.matchAll(/<(\/?)(b|a|code)\b[^>]*>/g)) {
        if (close) {
          if (open.pop() !== tag) return false;
        } else if (open.includes("code") || (tag === "code" && open.length > 0) || (tag === "a" && open.includes("a"))) {
          return false;
        } else {
          open.push(tag);
        }
      }
      return open.length === 0;
    };
    const notes = [
      PR_160,
      "**Tap `Move` now**",
      "**`a` [x `y` z](https://a.com) `b`**",
      "[**a `b` c**](https://a.com)",
      "**see [x](https://a.com/`b`) now**",
      "**a [**b**](https://a.com) c**",
      "`**x**` and **`y`**",
      "**a [b** c](https://a.com)",
    ];
    for (const note of notes) expect(nestsOk(noteHtml(note)), noteHtml(note)).toBe(true);
  });

  it("lets bold wrap onto a second line, but not across a blank one", () => {
    expect(noteHtml("**one\ntwo**")).toBe("<b>one\ntwo</b>");
    expect(noteHtml("**one\n\ntwo**")).toBe("**one\n\ntwo**");
  });

  it("leaves what it doesn't format as typed: a lone **, ** inside words, single stars, snake_case", () => {
    for (const s of ["5 ** 2 is big", "2**3 and 4**5", "a *single* star", "@lexigotchi_bot and _this_", "** spaced **", "```\nfenced\n```"]) {
      expect(noteHtml(s)).toBe(s);
    }
    expect(noteHtml("***both***")).toBe("<b>*both*</b>");
  });

  it("can't be fooled by the characters it uses to set code and links aside, nor leak them", () => {
    // The four marks: two around a code span's number, two around a link's.
    const marks = [0xe000, 0xe001, 0xe002, 0xe003].map((c) => String.fromCharCode(c));
    expect(noteHtml(`${marks[0]}0${marks[1]} ${marks[2]}0${marks[3]} **x** \`y\``)).toBe("0 0 <b>x</b> <code>y</code>");
    expect(noteHtml("[x](https://a.com/`b`) and [y](https://a.com/`c`)")).toBe("[x](https://a.com/<code>b</code>) and [y](https://a.com/<code>c</code>)");
  });
});

describe("the posts", () => {
  it("is one post for one note: its kind over a line of hyphens, then the note, formatted, with the as-typed text kept for a fallback", () => {
    // #181's note, as it was posted without saying what kind of update it was.
    const roll = "When a roll misses, tap **Roll again** to roll the same letter straight away.";
    expect(betaPosts([testerNote(`## Tester note (qol)\n\n${roll}`)!])).toEqual([
      {
        html: "✨ <b>Quality of life</b>\n-----------------\nWhen a roll misses, tap <b>Roll again</b> to roll the same letter straight away.",
        text: `✨ Quality of life\n-----------------\n${roll}`,
        notes: [0],
      },
    ]);
  });

  it("keeps a single note's line breaks, and adds nothing after it", () => {
    const [post] = betaPosts([{ kind: "fix", note: "One.\n\nTwo." }]);
    expect(post.html).toBe("🐛 <b>Bug fix</b>\n-----------\nOne.\n\nTwo.");
    expect(post.html).not.toMatch(/lexigotchi\.fun/);
  });

  it("says Update for a note that names no kind, or one it doesn't know", () => {
    const update = "📣 <b>Update</b>\n-----------\n<b>New:</b> a thing.";
    expect(betaPosts(["**New:** a thing."])[0].html).toBe(update);
    expect(betaPosts([{ kind: null, note: "**New:** a thing." }])[0].html).toBe(update);
    // Only the kinds it lists: never a name off the object's prototype.
    for (const kind of ["wibble", "toString", "constructor"]) {
      expect(betaPosts([{ kind, note: "**New:** a thing." }])[0].html).toBe(update);
    }
  });

  it("groups several notes by kind, in the order the kinds first appear, converting each note on its own", () => {
    // A stray ** in the first note must not pair with the next one's.
    const [post, ...more] = betaPosts([
      { kind: "fix", note: "Odd **star\nhere." },
      { kind: "new", note: "**Two.**" },
      { kind: "fix", note: "Three." },
      "Four.",
      { kind: "wibble", note: "Five." },
    ]);
    expect(more).toEqual([]);
    expect(post).toEqual({
      html: [
        "🐛 <b>Bug fix</b>\n-----------\n• Odd **star here.\n\n• Three.",
        "🆕 <b>New feature</b>\n----------------\n<b>Two.</b>",
        "📣 <b>Update</b>\n-----------\n• Four.\n\n• Five.",
      ].join("\n\n"),
      text: [
        "🐛 Bug fix\n-----------\n• Odd **star here.\n\n• Three.",
        "🆕 New feature\n----------------\n**Two.**",
        "📣 Update\n-----------\n• Four.\n\n• Five.",
      ].join("\n\n"),
      notes: [0, 1, 2, 3, 4],
    });
  });

  it("gives every kind a label that keeps the house copy rules, over a line about as wide as it", () => {
    for (const { emoji, label, rule } of [...KINDS.values(), UPDATE]) {
      expect(label).not.toMatch(/—|'|[A-Z]{2}/);
      expect(label[0]).toBe(label[0].toUpperCase());
      // A hyphen is narrower than most letters, so the line has at least one per letter of the label,
      // and not so many that it overshoots (the emoji counts as two letters, and the space one).
      const width = label.length + 3;
      expect(rule, label).toBeGreaterThanOrEqual(width - 3);
      expect(rule, label).toBeLessThanOrEqual(Math.ceil(width * 1.25));
      expect(emoji.length, label).toBeGreaterThan(0);
    }
  });

  it("posts notes one by one when together they'd pass Telegram's 4,096-character limit", () => {
    const long = "word ".repeat(500).trim();
    const posts = betaPosts([long, long, { kind: "fix", note: "**Short.**" }]);
    expect(posts.map((p) => p.notes)).toEqual([[0], [1], [2]]);
    expect(posts[2].html).toBe("🐛 <b>Bug fix</b>\n-----------\n<b>Short.</b>");
    for (const p of posts) expect(p.text.length).toBeLessThanOrEqual(4096);
  });

  it("cuts a note too long for one message, never in the middle of an emoji", () => {
    const [post] = betaPosts([{ kind: "heads-up", note: "🐸".repeat(5000) }]);
    expect(post.text).toBe(`⚠️ Heads up\n-------------\n${"🐸".repeat(1750)}…`);
    expect(post.text.length).toBeLessThanOrEqual(4096);
  });
});

describe("finding a PR's tester poll", () => {
  const body = (poll: string, heading = "## Tester poll") => `## Summary\n\nStuff.\n\n## Tester note (qol)\n\nRoll again.\n\n${heading}\n\n${poll}\n\n## Test plan\n- [x] done\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`;

  it("reads the question, then each list item as an answer, anonymous and single-answer by default", () => {
    expect(testerPoll(body("Did Roll again work for you?\n- Yes\n- No\n- I haven’t tried it"))).toEqual({
      ok: true,
      question: "Did Roll again work for you?",
      options: ["Yes", "No", "I haven’t tried it"],
      named: false,
      multiple: false,
    });
  });

  it("leaves the note alone, and the note leaves the poll alone", () => {
    const text = body("Did it work?\n- Yes\n- No");
    expect(testerNote(text)).toEqual({ kind: "qol", note: "Roll again." });
    expect(testerPoll(text)).toMatchObject({ question: "Did it work?", options: ["Yes", "No"] });
    // a poll written above the note
    const flipped = "## Tester poll\nDid it work?\n- Yes\n- No\n\n## Tester note (fix)\n\nFixed.";
    expect(testerNote(flipped)?.note).toBe("Fixed.");
    expect(testerPoll(flipped)).toMatchObject({ options: ["Yes", "No"] });
  });

  it("takes any list mark, task boxes, a question over several lines, and blank lines between answers", () => {
    expect(testerPoll(body("Which did you\nlike best?\n\n* Spell\n+ Mint\n\n1. The jackpot\n2) The bag\n- [ ] None\n- [x] All"))).toMatchObject({
      question: "Which did you like best?",
      options: ["Spell", "Mint", "The jackpot", "The bag", "None", "All"],
    });
  });

  it("writes formatting as its words: a poll takes none", () => {
    expect(testerPoll(body("Did **Roll again** and `Spell` [work](https://lexigotchi.fun/docs/rolls)?\n- **Yes**\n- `No`"))).toMatchObject({
      question: "Did Roll again and Spell work?",
      options: ["Yes", "No"],
    });
  });

  it("stops the list at the first line that isn't an answer, and the section at the next heading", () => {
    expect(testerPoll(body("Did it work?\n- Yes\n- No\nnotes for me\n- not an answer"))).toMatchObject({ options: ["Yes", "No"] });
    expect(testerPoll("## Tester poll\nDid it work?\n- Yes\n- No\n\n## Test plan\n- [x] a\n- [ ] b")).toMatchObject({ options: ["Yes", "No"] });
  });

  it("is named, or takes several answers, when the heading says so", () => {
    const poll = "Did it work?\n- Yes\n- No";
    expect(testerPoll(body(poll, "## Tester poll (named)"))).toMatchObject({ named: true, multiple: false });
    expect(testerPoll(body(poll, "### Tester poll: public"))).toMatchObject({ named: true });
    expect(testerPoll(body(poll, "## Tester poll (multiple)"))).toMatchObject({ named: false, multiple: true });
    expect(testerPoll(body(poll, "## Tester poll (named, multiple)"))).toMatchObject({ named: true, multiple: true });
    expect(testerPoll(body(poll, "## Tester poll (anonymous)"))).toMatchObject({ named: false, multiple: false });
  });

  it("is null with no section, an empty one, or one that says none; “Tester polls” is not it", () => {
    expect(testerPoll("## Summary\nStuff.\n\n## Tester note\nA note.")).toBeNull();
    expect(testerPoll("## Tester poll\n\n## Test plan\n- x")).toBeNull();
    expect(testerPoll("## Tester poll\nnone")).toBeNull();
    expect(testerPoll("## Tester polls\nDid it work?\n- Yes\n- No")).toBeNull();
    expect(testerPoll(null)).toBeNull();
    // a poll in a comment is not a poll
    expect(testerPoll("<!--\n## Tester poll\nDid it work?\n- Yes\n- No\n-->")).toBeNull();
  });

  it("says why, for a poll Telegram would refuse", () => {
    const why = (poll: string) => {
      const p = testerPoll(body(poll));
      return p && !p.ok ? p.why : null;
    };
    expect(why("Only a question?")).toBe("it has 0 answers (write each as a list item; a poll needs at least 2)");
    expect(why("Did it work?\n- Yes")).toBe("it has 1 answer (write each as a list item; a poll needs at least 2)");
    expect(why("- Yes\n- No")).toBe("it has no question above its answers");
    expect(why(`${"Did it work? ".repeat(30)}\n- Yes\n- No`)).toBe("its question is 389 characters (Telegram takes 300)");
    expect(why(`Which?\n${Array.from({ length: 13 }, (_, i) => `- Answer ${i + 1}`).join("\n")}`)).toBe("it has 13 answers (Telegram takes 12)");
    expect(why(`Which?\n- Yes\n- ${"long ".repeat(25)}`)).toMatch(/^the answer "long long long long long long …" is 124 characters \(Telegram takes 100\)$/);
    expect(why("Which?\n- Yes\n- yes")).toBe("two of its answers are the same");
    expect(why("Which?\n- Yes\n- \n- No")).toBe("one of its answers is empty");
  });

  it("takes a question and answers right at Telegram's limits", () => {
    const q = "Q".repeat(299) + "?";
    const twelve = Array.from({ length: 12 }, (_, i) => `${"a".repeat(98)}${String(i).padStart(2, "0")}`);
    expect(testerPoll(body(`${q}\n${twelve.map((o) => `- ${o}`).join("\n")}`))).toMatchObject({ ok: true, question: q, options: twelve });
  });
});

describe("the weekly poll", () => {
  it("is one Telegram would take, and keeps the house copy rules", () => {
    expect(pollProblem(PULSE_POLL.question, PULSE_POLL.options)).toBeNull();
    const all = [PULSE_POLL.question, ...PULSE_POLL.options].join("\n");
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    expect(PULSE_POLL.options.length).toBeGreaterThanOrEqual(3);
  });
});
