import { describe, expect, it } from "vitest";
// The same file the "Beta updates" workflow loads (plain JavaScript, so it runs with nothing installed).
import { betaPost, noteHtml, testerNote } from "../.github/scripts/tester-note.mjs";

// #160's note, as it was posted with its asterisks showing.
const PR_160 =
  "**New: your linked wallets count as one player.** The leaderboard adds them up into one row. Hunger warnings and \"daily letter ready\" reminders now cover all your wallets. You can also **move your letters** from one wallet to another: connect the wallet that holds them, open your profile, and tap **Move this wallet's letters**. The sending wallet needs a little Base Sepolia ETH for the fee. Staked words stay where they are.";

describe("finding a PR's tester note", () => {
  const body = (note: string) => `## Summary\n\nStuff.\n\n## Tester note\n\n${note}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`;

  it("takes the section up to the next heading, rule, or the Claude Code line", () => {
    expect(testerNote(body(PR_160))).toBe(PR_160);
    expect(testerNote("## Tester note\nOne.\n\n## Test plan\n- x")).toBe("One.");
    expect(testerNote("### Tester note\nOne.\n---\nmore")).toBe("One.");
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
  });

  it("turns `code` and https links into their own kinds, with nothing formatted inside code", () => {
    expect(noteHtml("Type `**not bold**` & see")).toBe("Type <code>**not bold**</code> &amp; see");
    expect(noteHtml("Read [the docs](https://lexigotchi.fun/docs?a=1&b=\"2\")."))
      .toBe('Read <a href="https://lexigotchi.fun/docs?a=1&amp;b=&quot;2&quot;">the docs</a>.');
    expect(noteHtml("[**Bold link**](https://lexigotchi.fun)")).toBe('<a href="https://lexigotchi.fun"><b>Bold link</b></a>');
    expect(noteHtml("[not a link](javascript:alert(1))")).toBe("[not a link](javascript:alert(1))");
  });

  it("leaves what it doesn't format as typed: a lone **, single stars, snake_case, a ** pair across lines", () => {
    for (const s of ["5 ** 2 is big", "a *single* star", "@lexigotchi_bot and _this_", "** spaced **", "**one\ntwo**"]) {
      expect(noteHtml(s)).toBe(s);
    }
  });
});

describe("the post", () => {
  it("is one note and the footer, formatted, with the as-typed text kept for a fallback", () => {
    expect(betaPost(["**New:** a thing."])).toEqual({
      html: "<b>New:</b> a thing.\n\nLive now at lexigotchi.fun/play",
      text: "**New:** a thing.\n\nLive now at lexigotchi.fun/play",
    });
  });

  it("bullets several notes on one line each, converting each on its own", () => {
    // A stray ** in the first note must not pair with the second note's.
    const post = betaPost(["Odd **star\nhere.", "**Two.**"]);
    expect(post.html).toBe("• Odd **star here.\n\n• <b>Two.</b>\n\nLive now at lexigotchi.fun/play");
    expect(post.text).toBe("• Odd **star here.\n\n• **Two.**\n\nLive now at lexigotchi.fun/play");
  });
});
