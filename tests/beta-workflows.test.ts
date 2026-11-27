/**
 * The two workflows that post to the beta testers' Telegram group, run here as GitHub would run
 * them: the script inside each YAML file, with GitHub's `github`, `context`, and `core` and
 * Telegram's API replaced. They can't be tried against the real group before they merge, and what
 * they send can't be taken back, so the paths that matter are held here: what is sent, in what
 * order, and that a poll which fails never stops a note from being marked as posted.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The `script: |` block of a workflow's github-script step, as JavaScript. Its `import(…)` of the
 * note script becomes a call to `load`, which the test passes in: code built from text has no
 * module loader of its own here.
 */
function scriptOf(workflow: string): string {
  const lines = readFileSync(`.github/workflows/${workflow}`, "utf8").split("\n");
  const at = lines.findIndex((l) => /^\s*script: \|$/.test(l));
  if (at < 0) throw new Error(`${workflow} has no script`);
  const indent = lines[at].search(/\S/);
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && l.search(/\S/) <= indent) break;
    body.push(l.slice(indent + 2));
  }
  const code = body.join("\n");
  if (!code.includes("await import(")) throw new Error(`${workflow}'s script loads nothing`);
  return code.replaceAll("await import(", "await load(");
}

interface Run {
  /** Telegram calls, in order: [method, body]. */
  telegram: [string, Record<string, unknown>][];
  /** PR numbers labelled `beta-posted`, in order. */
  labelled: number[];
  /** Everything that happened, in order: "send #…", "label #…", "poll #…". */
  order: string[];
  notices: string[];
  warnings: string[];
  failed: string | null;
  threw: string | null;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

/**
 * Run a workflow's script. `prs` are the repository's closed pull requests; `refuse` names the
 * Telegram methods that fail, with Telegram's own words.
 */
async function run(
  workflow: string,
  opts: { event: string; prs?: { number: number; body: string; mergedAt?: string; labels?: string[] }[]; refuse?: Record<string, string>; env?: Record<string, string | undefined> },
): Promise<Run> {
  const out: Run = { telegram: [], labelled: [], order: [], notices: [], warnings: [], failed: null, threw: null };
  const env = { GITHUB_WORKSPACE: process.cwd(), TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "-5000000001", ...opts.env };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  const realFetch = globalThis.fetch;
  let nextId = 50;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(String(init?.body ?? "{}"));
    out.telegram.push([method, body]);
    out.order.push(method === "sendPoll" ? `poll ${body.question}` : method);
    const why = opts.refuse?.[method];
    return new Response(JSON.stringify(why ? { ok: false, description: why } : { ok: true, result: { message_id: nextId++ } }));
  }) as typeof fetch;
  const merged = new Date().toISOString();
  const github = {
    rest: {
      pulls: {
        list: async () => ({
          data: (opts.prs ?? []).map((p) => ({ number: p.number, body: p.body, merged_at: p.mergedAt ?? merged, merge_commit_sha: `sha${p.number}`, labels: (p.labels ?? []).map((name) => ({ name })) })),
        }),
      },
      repos: { compareCommitsWithBasehead: async () => ({ data: { status: "behind" } }) },
      issues: {
        createLabel: async () => ({}),
        addLabels: async ({ issue_number }: { issue_number: number }) => {
          out.labelled.push(issue_number);
          out.order.push(`label #${issue_number}`);
        },
      },
    },
  };
  const context = { eventName: opts.event, repo: { owner: "o", repo: "r" }, payload: { deployment: { sha: "deployed" } } };
  const core = {
    notice: (m: string) => void out.notices.push(m),
    info: (m: string) => void out.notices.push(m),
    warning: (m: string) => void out.warnings.push(m),
    setFailed: (m: string) => void (out.failed = m),
  };
  try {
    const load = (file: string) => import(/* @vite-ignore */ file);
    await new AsyncFunction("github", "context", "core", "load", scriptOf(workflow))(github, context, core, load);
  } catch (err) {
    out.threw = (err as Error).message;
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return out;
}

const pr = (number: number, note: string, poll = "") => ({ number, body: `## Summary\n\nStuff.\n\n## Tester note (qol)\n\n${note}\n\n${poll}\n## Test plan\n- [x] done\n` });
const POLL = "## Tester poll\n\nDid it work for you?\n- Yes\n- No\n";

describe("Beta updates: a PR's poll", () => {
  it("goes out as a reply to the post that carries its note, after the PR is labelled", async () => {
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", POLL)] });
    expect(r.threw).toBeNull();
    expect(r.order).toEqual(["sendMessage", "label #7", "poll Did it work for you?"]);
    expect(r.telegram[1]).toEqual([
      "sendPoll",
      {
        chat_id: "-5000000001",
        question: "Did it work for you?",
        options: [{ text: "Yes" }, { text: "No" }],
        is_anonymous: true,
        allows_multiple_answers: false,
        reply_parameters: { message_id: 50, allow_sending_without_reply: true },
      },
    ]);
    expect(r.notices).toContain("Sent #7's poll.");
  });

  it("is named, or takes several answers, when its heading says so", async () => {
    const named = POLL.replace("## Tester poll", "## Tester poll (named, multiple)");
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", named)] });
    expect(r.telegram[1][1]).toMatchObject({ is_anonymous: false, allows_multiple_answers: true });
  });

  it("never stops a note from being marked as posted: a refused poll is a warning", async () => {
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", POLL)], refuse: { sendPoll: "Bad Request: poll question is too long" } });
    expect(r.threw).toBeNull();
    expect(r.labelled).toEqual([7]);
    expect(r.warnings).toEqual(["#7's tester poll was not sent: sendPoll: Bad Request: poll question is too long"]);
  });

  it("says why a poll it can't send wasn't sent, and still posts the note", async () => {
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", "## Tester poll\n\nOnly a question?\n")] });
    expect(r.order).toEqual(["sendMessage", "label #7"]);
    expect(r.warnings).toEqual(["#7's tester poll was not sent: it has 0 answers (write each as a list item; a poll needs at least 2)."]);
  });

  it("sends each PR's own poll when several notes share a post, and none for a PR without one", async () => {
    const other = POLL.replace("Did it work for you?", "Was the new card clear?");
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", POLL), pr(8, "No poll here."), pr(9, "A new card.", other)] });
    expect(r.order).toEqual(["sendMessage", "label #7", "label #8", "label #9", "poll Did it work for you?", "poll Was the new card clear?"]);
    // both polls answer the one post
    expect(r.telegram.slice(1).map(([, b]) => (b.reply_parameters as { message_id: number }).message_id)).toEqual([50, 50]);
  });

  it("needs a note: a poll alone posts nothing, and a posted PR's poll is never sent again", async () => {
    const alone = { number: 7, body: `## Summary\n\nStuff.\n\n${POLL}` };
    expect((await run("beta-updates.yml", { event: "deployment_status", prs: [alone] })).telegram).toEqual([]);
    const posted = { ...pr(8, "Roll again.", POLL), labels: ["beta-posted"] };
    expect((await run("beta-updates.yml", { event: "deployment_status", prs: [posted] })).telegram).toEqual([]);
  });

  it("still fails the run when the NOTE can't be sent, with nothing labelled, so the next deploy tries again", async () => {
    const r = await run("beta-updates.yml", { event: "deployment_status", prs: [pr(7, "Roll again.", POLL)], refuse: { sendMessage: "Forbidden: bot was kicked" } });
    expect(r.threw).toBe("sendMessage: Forbidden: bot was kicked");
    expect(r.labelled).toEqual([]);
    expect(r.telegram.map(([m]) => m)).toEqual(["sendMessage"]);
  });

  it("posts nothing on a manual run", async () => {
    const r = await run("beta-updates.yml", { event: "workflow_dispatch", prs: [pr(7, "Roll again.", POLL)] });
    expect(r.telegram.map(([m]) => m)).toEqual(["getMe", "getChat"]);
    expect(r.labelled).toEqual([]);
  });
});

describe("Beta pulse: the weekly poll", () => {
  const sent = [
    "sendPoll",
    { chat_id: "-5000000001", question: "How was Lexigotchi this week?", options: ["Loved it", "Good", "It was OK", "Frustrating", "I didn’t play"].map((text) => ({ text })), is_anonymous: true },
  ];

  it("is sent on the schedule, anonymous", async () => {
    const r = await run("beta-pulse.yml", { event: "schedule", env: { SEND: "" } });
    expect(r.threw).toBeNull();
    expect(r.failed).toBeNull();
    expect(r.telegram).toEqual([sent]);
  });

  it("is only shown on a manual run, unless “send” is ticked", async () => {
    const shown = await run("beta-pulse.yml", { event: "workflow_dispatch", env: { SEND: "false" } });
    expect(shown.telegram).toEqual([]);
    expect(shown.notices[0]).toBe("The poll: How was Lexigotchi this week? / Loved it / Good / It was OK / Frustrating / I didn’t play");
    expect((await run("beta-pulse.yml", { event: "workflow_dispatch", env: { SEND: "true" } })).telegram).toEqual([sent]);
  });

  it("fails with Telegram's own words when the poll is refused, and sends nothing without its secrets", async () => {
    expect((await run("beta-pulse.yml", { event: "schedule", refuse: { sendPoll: "Forbidden: bot was kicked" } })).failed).toBe("sendPoll: Forbidden: bot was kicked");
    const dark = await run("beta-pulse.yml", { event: "schedule", env: { TELEGRAM_BOT_TOKEN: undefined } });
    expect(dark.telegram).toEqual([]);
    expect(dark.failed).toBeNull();
  });
});
