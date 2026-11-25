import { NextResponse } from "next/server";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { readWordStory } from "@/lib/onchain/wordStory";
import { isWord } from "@/lib/dictionary";
import type { WordStory } from "@/lib/cardFacts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET ?word=CRANE — the word's story onchain (lib/onchain/wordStory): its claims and its changes of
 * hands, with block times. The back of a word's card reads it to say who found the word and since
 * when it has been the player's (lib/cardFacts). Public chain data, keyed by the word alone, so one
 * answer serves every player for a minute at the edge. The card asks only while its back is showing.
 */
export type StoryResponse = ({ ok: true; live: true } & WordStory) | { ok: true; live: false } | { ok: false; error: string };

export async function GET(req: Request) {
  const word = (new URL(req.url).searchParams.get("word") ?? "").toUpperCase();
  if (!isWord(word)) return NextResponse.json({ ok: false, error: "not_a_word" } satisfies StoryResponse, { status: 400 });
  // The practice game has no chain: its words' stories are made up in the practice store.
  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, live: false } satisfies StoryResponse);
  try {
    const story = await readWordStory(word);
    return NextResponse.json({ ok: true, live: true, ...story } satisfies StoryResponse, {
      headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[story] read failed:", word, (err as Error).message?.slice(0, 200));
    return NextResponse.json({ ok: false, error: "story_unavailable" } satisfies StoryResponse, { status: 503 });
  }
}
