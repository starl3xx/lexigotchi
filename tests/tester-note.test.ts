import { describe, expect, it } from "vitest";
// The same file the "Beta updates" workflow loads (plain JavaScript, so it runs with nothing installed).
import { betaPosts, noteHtml, testerNote } from "../.github/scripts/tester-note.mjs";

// #160's note, as it was posted with its asterisks showing.
const PR_160 =
  "**New: your linked wallets count as one player.** The leaderboard adds them up into one row. Hunger warnings and \"daily letter ready\" reminders now cover all your wallets. You can also **move your letters** from one wallet to another: connect the wallet that holds them, open your profile, and tap **Move this wallet's letters**. The sending wallet needs a little Base Sepolia ETH for the fee. Staked words stay where they are.";
const FOOTER = "Live now at lexigotchi.fun/play";

describe("finding a PR's tester note", () => {
  const body = (note: string) => `## Summary\n\nStuff.\n\n## Tester note\n\n${note}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`;

  it("takes the section up to the next heading, rule, or the Claude Code line", () => {
    expect(testerNote(body(PR_160))).toBe(PR_160);
    expect(testerNote("## Tester note\nOne.\n\n## Test plan\n- x")).toBe("One.");
    for (const rule of ["---", "***", "___", "* * *", "- - -", "_ _ _"]) {
      expect(testerNote(`### Tester note\nOne.\n${rule}\ninternal notes`)).toBe("One.");
    }
  });

  it("has no note without the section, an empty one, or a “none”", () => {
    expect(testerNote("## Summary\nStuff.")).toBeNull();
    expect(testerNote(null)).toBeNull();
    expect(testerNote(body("None"))).toBeNull();
    expect(testerNote(body("n/a"))).toBeNull();
    expect(testerNote("## Tester note\n<!-- one or two sentences -->\n")).toBeNull();
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

  it("lets bold hold code and links, and a link's label hold code and bold", () => {
    expect(noteHtml("**Tap `Move` now**")).toBe("<b>Tap <code>Move</code> now</b>");
    expect(noteHtml("**Read [the docs](https://a.com) first**")).toBe('<b>Read <a href="https://a.com">the docs</a> first</b>');
    expect(noteHtml("[`code` label](https://a.com)")).toBe('<a href="https://a.com"><code>code</code> label</a>');
    expect(noteHtml("[**Bold link**](https://a.com)")).toBe('<a href="https://a.com"><b>Bold link</b></a>');
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
    expect(noteHtml("0 **x** `y`")).toBe("0 <b>x</b> <code>y</code>");
    expect(noteHtml("[x](https://a.com/`b`) and [y](https://a.com/`c`)")).toBe("[x](https://a.com/<code>b</code>) and [y](https://a.com/<code>c</code>)");
  });
});

describe("the posts", () => {
  it("is one post for one note, formatted, with the as-typed text kept for a fallback", () => {
    expect(betaPosts(["**New:** a thing."])).toEqual([
      { html: `<b>New:</b> a thing.\n\n${FOOTER}`, text: `**New:** a thing.\n\n${FOOTER}`, notes: [0] },
    ]);
  });

  it("bullets several notes on one line each, converting each on its own", () => {
    // A stray ** in the first note must not pair with the second note's.
    const [post, ...more] = betaPosts(["Odd **star\nhere.", "**Two.**"]);
    expect(more).toEqual([]);
    expect(post).toEqual({
      html: `• Odd **star here.\n\n• <b>Two.</b>\n\n${FOOTER}`,
      text: `• Odd **star here.\n\n• **Two.**\n\n${FOOTER}`,
      notes: [0, 1],
    });
  });

  it("posts notes one by one when together they'd pass Telegram's 4,096-character limit", () => {
    const long = "word ".repeat(500).trim();
    const posts = betaPosts([long, long, "**Short.**"]);
    expect(posts.map((p) => p.notes)).toEqual([[0], [1], [2]]);
    expect(posts[2].html).toBe(`<b>Short.</b>\n\n${FOOTER}`);
    for (const p of posts) expect(p.text.length).toBeLessThanOrEqual(4096);
  });

  it("cuts a note too long for one message, never in the middle of an emoji", () => {
    const [post] = betaPosts(["🐸".repeat(5000)]);
    expect(post.text).toBe(`${"🐸".repeat(1750)}…\n\n${FOOTER}`);
    expect(post.text.length).toBeLessThanOrEqual(4096);
  });
});
