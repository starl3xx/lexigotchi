/**
 * Proof: the case's storage against a real Postgres (lib/db/wordCases.ts; decisions.md #42). The
 * unit tests stand a map in for the database, so they can't show that the SQL runs, that a row
 * saved under a linked wallet's own key counts for its profile, or that two requests at once
 * can't both take the last free case (the advisory lock). This does.
 *
 * It empties `word_picks` and `wallet_links`, so it refuses any database that isn't on this
 * machine. A throwaway one:
 *
 *   createdb lexi_case_check && for f in drizzle/0*.sql; do sed 's/--> statement-breakpoint//g' "$f" | psql -q -d lexi_case_check; done
 *   DATABASE_URL=postgresql://localhost/lexi_case_check npx tsx scripts/case-db-check.ts
 *
 * Rerun it after touching lib/db/wordCases.ts or the picks table.
 */
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@/lib/db/client";
import { casesFor, setCase } from "@/lib/db/wordCases";
import { clearPicksOffLeftWords, saveScenePicks, scenePicksFor } from "@/lib/db/wordPicks";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^[a-z]+:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(url)) throw new Error("DATABASE_URL must be on this machine");

  const A = "0x00000000000000000000000000000000000000a1";
  const B = "0x00000000000000000000000000000000000000b2";
  const C = "0x00000000000000000000000000000000000000c3";
  let failed = 0;
  const check = (name: string, ok: boolean, got?: unknown) => {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " → " + JSON.stringify(got)}`);
  };
  const words = async (w: string[]) => (await casesFor(w)).map((c) => `${c.wallet.slice(-2)}:${c.word}`).sort();

  const db = getDb();
  await db.execute(sql`delete from word_picks`);
  await db.execute(sql`delete from wallet_links`);

  check("no case bought: refused", (await setCase(A, "CRANE", true, 0)) === "none_left");
  check("nothing stored after a refusal", (await words([A])).length === 0);
  check("one bought: a word goes in", (await setCase(A, "CRANE", true, 1)) === "ok");
  const first = (await casesFor([A]))[0];
  check("it is listed, with when it went in", first?.word === "CRANE" && first.since instanceof Date, first);
  check("a second word is refused", (await setCase(A, "VIVID", true, 1)) === "none_left");
  await new Promise((r) => setTimeout(r, 30));
  check("the same word again is fine", (await setCase(A, "CRANE", true, 1)) === "ok");
  const again = (await casesFor([A]))[0];
  check("and keeps its date and its one row", again.since.getTime() === first.since.getTime() && (await casesFor([A])).length === 1, again);

  // two requests at once for the last free case: exactly one gets it
  const race = await Promise.all([setCase(A, "VIVID", true, 2), setCase(A, "MOTEL", true, 2)]);
  check("two at once for the last case: one ok, one refused", race.slice().sort().join() === "none_left,ok", race);
  check("two words in two cases", (await words([A])).length === 2, await words([A]));

  // a scene pick of the same word is another row, and is left alone
  await saveScenePicks(A, [{ word: "CRANE", scene: "stage", at: new Date() }], new Map());
  check("a scene read lists no case", JSON.stringify((await scenePicksFor([A])).map((p) => `${p.word}:${p.scene}`)) === '["CRANE:stage"]', await scenePicksFor([A]));
  check("taking the word out", (await setCase(A, "CRANE", false, 0)) === "ok");
  check("frees the case and keeps the scene", !(await words([A])).includes("a1:CRANE") && (await scenePicksFor([A])).length === 1);
  check("taking out a word that isn't in one is fine", (await setCase(A, "PLUMB", false, 0)) === "ok");

  // a linked wallet: B joins A's profile; a row saved under B's own key before it joined counts
  await db.execute(sql`delete from word_picks where kind = 'case'`);
  await db.execute(sql`insert into word_picks (profile, word, kind, value) values (${B}, 'TEASE', 'case', 'slab')`);
  await db.execute(sql`insert into wallet_links (address, account) values (${B}, ${A})`);
  check("the profile sees a case saved under a member's own key, for each wallet named", JSON.stringify(await words([A, B])) === '["a1:TEASE","b2:TEASE"]', await words([A, B]));
  check("it counts as a case in use", (await setCase(A, "CRANE", true, 1)) === "none_left");
  check("and it is already in a case: no second row", (await setCase(A, "TEASE", true, 1)) === "ok" && (await casesFor([A])).length === 1);
  check("it comes out, whichever key it sits under", (await setCase(A, "TEASE", false, 0)) === "ok" && (await words([A])).length === 0);
  check("another profile's cases are its own", (await setCase(C, "TEASE", true, 1)) === "ok" && (await words([A, C])).join() === "c3:TEASE", await words([A, C]));

  // the keeper takes a case off a word another profile holds now, with its scene
  await setCase(A, "CRANE", true, 5);
  const cleared = await clearPicksOffLeftWords(new Map([["CRANE", C]]), (k) => (k === B ? A : k));
  check("the keeper clears the case (and the scene) off a word that left the profile", cleared === 2 && !(await words([A])).includes("a1:CRANE") && (await scenePicksFor([A])).length === 0, cleared);

  await closeDb();
  console.log(failed ? `${failed} FAILED` : "all ok");
  process.exit(failed ? 1 : 0);
}

void main();
