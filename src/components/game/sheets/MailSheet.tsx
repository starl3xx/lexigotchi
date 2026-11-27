"use client";
/**
 * A pack comes by mail (decisions.md #49; starl3xx, 2026-11-26: buying a pack was "just click and
 * wait until it's revealed").
 *
 * The sheet opens with the tap, on an envelope. Each thing the envelope then shows is a state of
 * the purchase, in the chain's own order, and nothing shows before it is true:
 *   the wallet is open        an addressed envelope with an empty place for a stamp
 *   the commit is sent        the stamp goes on (the price is spent)
 *   the commit is on chain    the postmark lands, with the mail's number; eyes at the window
 *   the reveal is on chain    the pull tab nudges: only now can it be torn
 * A long wait is company: the eyes blink and glance about, and after a while they nod off.
 *
 * Then the player tears the strip along the top (a drag that follows the finger, or one tap), and
 * the letters climb out one at a time, eyes first over the torn edge: the plain ones quickly, the
 * one worth waiting for last, and it can't look. The count ends on the word they finish.
 *
 * The rules are in ../mail/mailFlow.ts (pure, tested). What this file must keep:
 * - A tile's size never changes (#48): letters and the pictures around them only move and turn.
 * - The envelope is still pictures (lib/cardArt/mail), moved whole. Nothing moves inside one.
 * - The drag writes its transform straight to the strip, a frame at a time: no render per move.
 * - All travel sits behind `prefers-reduced-motion: no-preference` (globals.css, `.mail-*`). With
 *   reduced motion the same things are shown and said, in place.
 * - The purchase outlives the sheet. Closing it stops nothing: the envelope waits on Today.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { fmtOdds, letterOdds, packsPer } from "@/lib/letterOdds";
import { CONTENTS, ENV, EYES, POSTMARK, SPARKLES, STAMP, STAMP_PLACE, STRIP, envBack, envFront, envStrip, envWindow, eyesArt, mailUri, postmarkArt, sparklesArt, stampArt, type Gaze } from "@/lib/cardArt/mail";
import { bagTotals } from "@/lib/wordNeed";
import { TileCharacter, usePrefersReducedMotion, useWordLife, type TileState } from "../TileCharacter";
import { Button, Sheet, TierBadge } from "../primitives";
import { WordTiles } from "../LetterTile";
import { fmtWord, mineLower, mineUpper, useGame } from "../state";
import { useTakenWords } from "../useTodayPlan";
import { useWorld } from "../useWorld";
import { useLetterSupply } from "../useLetterSupply";
import { useMyName } from "../useMyName";
import { newlySpellableWith } from "./BoughtLettersSheet";
import { useMailCues } from "../useSound";
import { SoundToggle } from "../SoundToggle";
import { bagWithMail, bestLine, countHead, countSub, finishers, hadFor, mailNumberText, mailStatus, nextTearIsQuick, revealBeats, revealOrder, tagOf, type Mail, type Pull } from "../mail/mailFlow";
import { useTierOf } from "../useRarity";
import { rarestFirstBy } from "@/lib/market/deals";

// ── measures: one box, 328 wide, drawn larger or smaller as a whole to fit the sheet ─────────────
const W = 328;
/** Where a letter that has come out stands: its feet, from the box's top. */
const FEET = 96;
const ENV_TOP = 112;
const EK = W / ENV.w;
const ENV_H = ENV.h * EK;
const BOX_H = ENV_TOP + ENV_H + 8;
/** With the count showing, the envelope is gone: the box is the row and its tags. */
const ROW_H = FEET + 34;
/** While it is waited for, the envelope sits this much higher: the row above it is still empty. */
const LIFT = 44;
const sizeOf = (n: number) => (n === 1 ? 76 : 64);
const slotX = (i: number, n: number) => (n === 1 ? (W - 76) / 2 : i * 66);
/** A letter's drawing is 240 × 340 with its feet at 300: so its top, for feet at FEET. */
const topOf = (size: number) => FEET - size * 1.25;
const tall = (size: number) => (size * 340) / 240;
/** The front's torn edge, from the box's top. */
const TEAR_Y = ENV_TOP + ENV.tear * EK;
const STRIP_H = STRIP.h * EK;

/** The pictures, made the first time an envelope shows and kept: each is one still document. */
let art: ReturnType<typeof makeArt> | null = null;
function makeArt() {
  const eyes = (g: Gaze) => mailUri(eyesArt(g), EYES.w, EYES.h);
  return {
    back: mailUri(envBack(), ENV.w, ENV.h),
    front: { 1: mailUri(envFront(1), ENV.w, ENV.h), 5: mailUri(envFront(5), ENV.w, ENV.h) } as Record<number, string>,
    strip: mailUri(envStrip(), STRIP.w, STRIP.h),
    stamp: mailUri(stampArt(), STAMP.w, STAMP.h),
    postmark: mailUri(postmarkArt(), POSTMARK.w, POSTMARK.h),
    eyes: { you: eyes("you"), left: eyes("left"), right: eyes("right"), up: eyes("up"), shut: eyes("shut") } as Record<Gaze, string>,
    spark: [mailUri(sparklesArt(0), SPARKLES.w, SPARKLES.h), mailUri(sparklesArt(1), SPARKLES.w, SPARKLES.h)],
  };
}
const ART = () => (art ??= makeArt());

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const clamp = (v: number) => Math.max(0, Math.min(1, v));

const Pic = ({ src, w, style, className, innerRef }: { src: string; w: number; style?: CSSProperties; className?: string; innerRef?: React.Ref<HTMLImageElement> }) => (
  // eslint-disable-next-line @next/next/no-img-element -- a still picture made here, not a file to optimise
  <img ref={innerRef} src={src} width={w} alt="" draggable={false} className={className} style={{ display: "block", position: "absolute", maxWidth: "none", ...style }} />
);


/**
 * Pairs of eyes at the window: the letters, before anyone knows which. They blink out of step (a
 * swap in steps, which costs nothing), and now and then one glances aside. One timer for them all.
 */
const WindowEyes = memo(function WindowEyes({ count, look, asleep, gone, still }: { count: number; look?: Gaze; asleep: number; gone: readonly boolean[]; still: boolean }) {
  const [glance, setGlance] = useState<{ i: number; g: Gaze } | null>(null);
  useEffect(() => {
    if (look || still) return;
    let back = 0;
    const id = window.setInterval(() => {
      setGlance({ i: Math.floor(Math.random() * count), g: Math.random() < 0.5 ? "left" : "right" });
      back = window.setTimeout(() => setGlance(null), 650);
    }, 1500);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(back);
    };
  }, [look, still, count]);
  const a = ART();
  const win = envWindow(count);
  const [w, pitch] = [32, 37];
  const row0 = win.x * EK + (win.w * EK - ((count - 1) * pitch + w)) / 2;
  const top = (win.y + win.h / 2) * EK - (w * EYES.h) / EYES.w / 2;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        if (gone[i]) return null;
        const sleeping = i < asleep;
        const g: Gaze = sleeping ? "shut" : (look ?? (glance?.i === i ? glance.g : "you"));
        return (
          <span key={i} className={cx("mail-eyes", !sleeping && "is-awake")} style={{ left: row0 + i * pitch, top, width: w, height: (w * EYES.h) / EYES.w, ["--d" as string]: `${-((i * 1.37) % 4.6)}s` }}>
            <Pic src={a.eyes[g]} w={w} className="mail-eyes-open" />
            <Pic src={a.eyes.shut} w={w} className="mail-eyes-shut" />
          </span>
        );
      })}
    </>
  );
});

type Pos = "in" | "peek" | "out";

/** One envelope, from wherever its purchase stands to the count. Keyed by the mail's `seq`. */
function MailStage({ mail }: { mail: Mail }) {
  const tierOf = useTierOf();
  const g = useGame();
  const { state } = g;
  const reduced = usePrefersReducedMotion();
  const name = useMyName();
  const a = ART();
  const n = mail.count;
  const size = sizeOf(n);

  // ── the box, drawn to fit the sheet ──────────────────────────────────────────────────────────
  const fit = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = fit.current;
    if (!el) return;
    const measure = () => setK(Math.max(0.8, Math.min(1.3, el.clientWidth / W)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── what the letters are to the player (the count's rules: BoughtLettersSheet, generalised) ────
  const taken = useTakenWords();
  const world = useWorld();
  const lower = mineLower(state);
  const upper = mineUpper(state);
  const letters = mail.letters;
  const checking = state.chainBacked && !world.data?.owners && world.isPending === true;
  /**
   * Nothing may be said about these letters beyond what they are: they went to another wallet of
   * the player's ("away"), or what the bag held before them isn't known (`Mail.plain`). No "new",
   * no word a letter finishes, no "now you can spell".
   */
  const plain = !mail.mine || mail.plain === true;
  /** The piece's letters, a count per letter, each with what the bag held before. */
  const added = useMemo(() => {
    const counts = new Map<number, number>();
    for (const i of letters ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts].map(([letterId, count]) => ({ letterId, count, had: mail.had[letterId] ?? 0 }));
  }, [letters, mail.had]);
  const fresh = useMemo(() => {
    if (!letters || plain || checking) return [];
    return newlySpellableWith(lower, upper, added, taken, rarestFirstBy(tierOf));
  }, [letters, plain, added, checking, lower, upper, taken, tierOf]);
  // The letters' standing is fixed at the tear, so a word list that lands a moment later can't
  // reorder letters that are already climbing out.
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const orderNow = (): Pull[] => {
    if (!letters) return [];
    const before = bagTotals({ lower: lower.map((v, i) => Math.min(v, mail.had[i] ?? 0)), upper: [...upper] });
    // The chain minted these letters onto what the bag held, but the game's read of the bag is
    // often a few seconds behind the reveal, and the tear comes inside them. So which letter
    // finishes a word is worked out from the bag as the chain has it (`bagWithMail`), not from a
    // read that may not show the letters yet. Only the count's claim waits for the bag itself.
    const words = plain || checking ? [] : newlySpellableWith(bagWithMail(lower, mail.had, letters), upper, added, taken, rarestFirstBy(tierOf)).map((f) => f.word);
    // A plain piece measures "new" from a bag that holds every letter (`hadFor`): none is called new.
    return revealOrder(letters, hadFor(mail), finishers(words, before));
  };

  // ── the wait ─────────────────────────────────────────────────────────────────────────────────
  const [fidget, setFidget] = useState(false);
  const [asleep, setAsleep] = useState(0);
  const [dozing, setDozing] = useState(false);
  const found = mail.phase === "found";
  useEffect(() => {
    if (!found || reduced || dozing) return;
    // somebody shifts inside, now and then
    const id = window.setInterval(() => {
      setFidget(true);
      window.setTimeout(() => setFidget(false), 520);
    }, 2600);
    return () => window.clearInterval(id);
  }, [found, reduced, dozing]);
  useEffect(() => {
    if (!found) return;
    // a long wait: they nod off one by one, and wake when the mail is ready
    const id = window.setTimeout(() => setDozing(true), DOZE_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [found]);
  useEffect(() => {
    if (!dozing || !found) return;
    const id = window.setInterval(() => setAsleep((v) => Math.min(n, v + 1)), 520);
    return () => window.clearInterval(id);
  }, [dozing, found, n]);
  const ready = mail.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    setAsleep(0);
    setDozing(false);
  }, [ready]);

  // ── the tear: the strip follows the finger, written straight to the element ───────────────────
  const flat = useRef<HTMLImageElement>(null);
  const lifted = useRef<HTMLImageElement>(null);
  const tear = useRef({ p: 0, raf: 0, from: null as null | { x: number; p0: number; moved: boolean }, done: false });
  const [started, setStarted] = useState(false); // the strip has left its rest: the nudge stops
  const [torn, setTorn] = useState(false);
  const paint = (p: number) => {
    tear.current.p = p;
    if (flat.current) flat.current.style.clipPath = `inset(0 0 0 ${p * 100}%)`;
    const el = lifted.current;
    if (!el) return;
    el.style.visibility = p > 0 ? "visible" : "hidden";
    el.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
    el.style.transformOrigin = `${p * W}px ${STRIP_H}px`;
    el.style.transform = `rotate(${-(7 + p * 9)}deg)`;
  };
  useEffect(() => () => cancelAnimationFrame(tear.current.raf), []);

  // ── the letters come out ─────────────────────────────────────────────────────────────────────
  const [pos, setPos] = useState<Pos[]>(() => Array.from({ length: n }, () => "in" as Pos));
  const [shake, setShake] = useState(false);
  const [note, setNote] = useState("");
  const [counted, setCounted] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => void timers.current.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);
  const put = (i: number, v: Pos) => setPos((all) => all.map((x, at) => (at === i ? v : x)));

  /** The strip is off, however it got there: once. The letters must not wait for a release. */
  const open = () => {
    if (tear.current.done) return;
    tear.current.done = true;
    cancelAnimationFrame(tear.current.raf);
    const order = orderNow();
    const quick = nextTearIsQuick();
    setPulls(order);
    setTorn(true);
    g.mailTorn();
    if (reduced) {
      setPos(order.map(() => "out"));
      const best = order.find((p) => p.best);
      if (best) setNote(bestLine(best));
      later(() => setCounted(true), 500);
      return;
    }
    const { beats, done } = revealBeats(order, quick);
    for (const b of beats) {
      const p = order[b.at];
      if (b.shake !== undefined) {
        later(() => setShake(true), b.shake);
        later(() => setShake(false), b.shake + 460);
      }
      if (b.peek !== undefined)
        later(() => {
          put(b.at, "peek");
          if (p.best && p.rare) setNote("Somebody’s shy.");
        }, b.peek);
      later(() => {
        put(b.at, "out");
        if (p.best) setNote(bestLine(p));
      }, b.out);
    }
    later(() => setCounted(true), done);
  };
  /** A tap while they come out: all of them, now. */
  const hurry = () => {
    if (!torn || counted || !pulls) return;
    clearTimers();
    setShake(false);
    setPos(pulls.map(() => "out"));
    later(() => setCounted(true), 380);
  };
  const finish = () => {
    const t = tear.current;
    if (t.done) return;
    setStarted(true);
    const from = t.p;
    const ms = reduced ? 0 : Math.max(120, (1 - from) * 420);
    const t0 = performance.now();
    const step = (now: number) => {
      const u = ms ? clamp((now - t0) / ms) : 1;
      paint(from + (1 - from) * (1 - (1 - u) ** 2));
      if (u < 1) t.raf = requestAnimationFrame(step);
      else open();
    };
    t.raf = requestAnimationFrame(step);
  };
  const spring = () => {
    const t = tear.current;
    const from = t.p;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = clamp((now - t0) / 180);
      paint(from * (1 - u));
      if (u < 1) t.raf = requestAnimationFrame(step);
      else setStarted(false);
    };
    t.raf = requestAnimationFrame(step);
  };
  const drag = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (!ready || tear.current.done) return;
      cancelAnimationFrame(tear.current.raf);
      e.currentTarget.setPointerCapture(e.pointerId);
      tear.current.from = { x: e.clientX, p0: tear.current.p, moved: false };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const from = tear.current.from;
      if (!from || tear.current.done) return;
      const d = (e.clientX - from.x) / k; // the box is drawn k times its size
      if (Math.abs(d) > 5 && !from.moved) {
        from.moved = true;
        setStarted(true);
      }
      if (!from.moved) return;
      const p = clamp(from.p0 + d / (W - 40));
      // one long drag to the end takes the strip away while the finger is still down: open now
      if (p >= 0.97) {
        paint(1);
        open();
      } else paint(p);
    },
    onPointerUp: () => {
      const from = tear.current.from;
      tear.current.from = null;
      if (!from || tear.current.done) return;
      if (!from.moved || tear.current.p > 0.3) finish();
      else spring();
    },
    onPointerCancel: () => {
      const from = tear.current.from;
      tear.current.from = null;
      if (from?.moved && !tear.current.done) (tear.current.p > 0.3 ? finish : spring)();
    },
    // a keyboard or a screen reader presses the button with no pointer at all
    onClick: (e: { detail: number }) => {
      if (ready && e.detail === 0) finish();
    },
  };

  // ── the row's life: one timer for all the letters that are out and at rest ────────────────────
  const row = useRef<HTMLDivElement>(null);
  useWordLife(row, torn && !reduced);

  // ── what is said ─────────────────────────────────────────────────────────────────────────────
  const preparing = mail.phase === "wallet" && g.busy?.phase === "preparing";
  const dozeLine = dozing && found ? (n === 1 ? "It nodded off. Any second now." : "They nodded off. Any second now.") : "";
  const status = torn ? note || (counted || reduced ? "" : "Tap to hurry them along.") : preparing ? "Getting it ready…" : dozeLine || mailStatus(mail);
  const stuck = mail.phase === "waiting" || mail.phase === "finishing";
  const has = (p: "paid" | "found") => mail.phase !== "wallet" && (p === "paid" || mail.phase !== "paid") && (p === "paid" || mail.number !== null || mail.phase === "found" || mail.phase === "ready");
  const stamped = has("paid");
  const marked = has("found") && mail.number !== null;
  const eyesOn = (mail.phase === "found" || mail.phase === "ready") && !counted;
  // The envelope's two halves move as one: the same class on each, so the letters between them
  // (which have their own places) never ride along.
  const moving = cx(mail.phase === "wallet" && "mail-drop", fidget && "mail-fidget", shake && "mail-shake", counted && "mail-leave");
  const lift = torn ? 0 : LIFT;

  const first = fresh[0];
  const claim = g.price("claim");
  const packPrice = g.price("pack");
  const again = () => {
    if (!g.canAfford(packPrice)) return g.openSheet({ kind: "balance", need: { amount: packPrice, action: "a pack" } });
    void g.buyPack();
  };
  const rarity = useRarity(pulls);
  // Its sounds follow its steps (mail/mailCues): never what it shows when it appears.
  useMailCues({
    phase: mail.phase,
    numbered: marked,
    torn,
    fidget,
    out: torn ? pos.filter((v) => v === "out").length : 0,
    rareOut: !!pulls && pulls.some((p, i) => p.best && p.rare && pos[i] === "out"),
    word: counted && !!first,
  });

  return (
    <div className="flex flex-col items-center pb-1">
      <div ref={fit} className="w-full">
        <div className="mail-stage mx-auto" style={{ width: W * k, height: (counted ? ROW_H : BOX_H) * k }}>
          {/* The box is drawn k times its size to fit the sheet (a fixed size, never a moving one).
              Inside it, only the lift is ever in motion. */}
          <div className="mail-box" style={{ width: W, height: BOX_H, transform: `scale(${k})` }}>
          <div className="mail-lift" style={{ transform: `translateY(${-lift}px)` }} onClick={hurry}>
            <div className={cx("mail-piece", moving)} style={{ top: ENV_TOP, width: W, height: ENV_H, zIndex: 1 }}>
              <Pic src={a.back} w={W} />
            </div>

            {/* the letters: inside the envelope until it is torn, then up over the torn edge and out */}
            <div ref={row} className="absolute inset-0" style={{ zIndex: 2 }}>
              {torn &&
                pulls?.map((p, i) => {
                  const top = topOf(size);
                  const y = pos[i] === "in" ? TEAR_Y + 4 - top : pos[i] === "peek" ? TEAR_Y - size * 0.56 - top : 0;
                  const out = pos[i] === "out";
                  // the best one can't look as it comes up; out, it stands like a letter just raised
                  const mood: TileState = p.best && p.rare && pos[i] === "peek" ? "rolling" : "idle";
                  return (
                    <div key={i} className="mail-letter" data-pos={pos[i]} style={{ left: slotX(i, n), top, width: size, height: tall(size), transform: `translateY(${y}px)` }}>
                      {p.best && p.rare && out && (
                        <>
                          <Pic src={a.spark[0]} w={size} className="mail-spark mail-spark-a" />
                          <Pic src={a.spark[1]} w={size} className="mail-spark mail-spark-b" />
                        </>
                      )}
                      <TileCharacter char={String.fromCharCode(65 + p.idx)} size={size} detail="full" state={mood} pose={p.best && p.rare && out ? "hero" : "rest"} index={i} />
                    </div>
                  );
                })}
            </div>

            <div className={cx("mail-piece", moving)} style={{ top: ENV_TOP, width: W, height: ENV_H, zIndex: 3 }}>
              <Pic src={a.front[n]} w={W} />
              {/* the envelope's lettering: the card's serif, for what a card says about its letters */}
              <span className="mail-serif absolute overflow-hidden text-ellipsis whitespace-nowrap text-[15px] italic text-ink/80" style={{ left: 30, top: 48, maxWidth: 142 }}>
                For {name ?? "you"}
              </span>
              <span className="mail-serif absolute overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-ink/60" style={{ left: 30, top: 77, maxWidth: 142 }}>
                from the Lexigotchi Mint
              </span>
              <span className="mail-serif absolute flex flex-col items-center justify-center text-ink" style={{ left: CONTENTS.x * EK, top: CONTENTS.y * EK, width: CONTENTS.w * EK, height: CONTENTS.h * EK }}>
                <span className="text-[9.5px] leading-[1.25] text-ink/65">Contents:</span>
                <span className="text-[12.5px] font-bold leading-[1.2]">{n === 1 ? "1 letter" : "5 letters"}</span>
              </span>
              {eyesOn && <WindowEyes count={n} look={ready && !torn ? "up" : torn ? "up" : undefined} asleep={asleep} gone={pos.map((v) => torn && v !== "in")} still={reduced} />}
              {stamped && (
                <span className={cx("absolute", mail.phase === "paid" && "mail-stick")} style={{ left: STAMP_PLACE.x * EK, top: STAMP_PLACE.y * EK, width: STAMP_PLACE.s * EK, height: STAMP_PLACE.s * EK, ["--rest" as string]: "rotate(3deg)", transform: "rotate(3deg)" }}>
                  <Pic src={a.stamp} w={STAMP_PLACE.s * EK} />
                </span>
              )}
              {marked && (
                <span className={cx("absolute", mail.phase === "found" && "mail-thunk")} style={{ left: 176, top: 52, width: POSTMARK.w * (112 / POSTMARK.w), height: POSTMARK.h * (112 / POSTMARK.w), transform: "rotate(-8deg)" }}>
                  <Pic src={a.postmark} w={112} />
                  <span className="mail-serif absolute text-center leading-none text-[#3a3734]" style={{ left: 0, width: 62, top: 20 }}>
                    <span className="block text-[7px]">No.</span>
                    <span className={cx("block font-bold", (mail.number ?? 0) > 99_999 ? "text-[8px]" : "text-[10.5px]")}>{(mail.number ?? 0).toLocaleString("en-US")}</span>
                  </span>
                </span>
              )}
              {!torn && (
                <button type="button" aria-label="Tear the envelope open" disabled={!ready} className={cx("mail-grab absolute left-0 top-0", ready && "is-ready")} style={{ width: W, height: STRIP_H + 10, touchAction: "pan-y" }} {...drag}>
                  <span className={cx("absolute inset-0", ready && !started && "mail-nudge")}>
                    <Pic innerRef={flat} src={a.strip} w={W} />
                    <Pic innerRef={lifted} src={a.strip} w={W} style={{ visibility: "hidden" }} />
                  </span>
                </button>
              )}
            </div>

            {counted &&
              pulls?.map((p, i) => {
                const tag = tagOf(p);
                if (!tag) return null;
                return (
                  <span key={i} className="mail-tag absolute flex justify-center" style={{ left: slotX(i, n) - 14, width: size + 28, top: FEET + 8, zIndex: 4, animationDelay: `${i * 70}ms` }}>
                    <span className={cx("rounded-full border-2 border-ink px-1.5 text-[11px] font-bold leading-[1.35]", tag.kind === "word" ? "bg-teal/25 text-teal-ink" : tag.kind === "rare" ? "bg-gold/30 text-gold-ink" : "bg-card text-ink")}>{tag.text}</span>
                  </span>
                );
              })}
          </div>
          </div>
        </div>
      </div>

      {!counted && (
        <p className={cx("mail-status", (note || dozeLine) && "is-note")} aria-live="polite">
          {status}
        </p>
      )}
      {!counted && <SoundToggle compact />}

      {counted && pulls && (
        <div className="mail-count w-full text-center">
          <div className="font-display text-2xl font-extrabold">{countHead(pulls)}</div>
          <p className="mx-auto max-w-[32ch] text-balance text-sm text-ink/70">{mail.mine ? countSub(pulls, rarity) : "They’re in your other wallet. Move them here to spell with them."}</p>
          {first ? (
            <div className="mt-3 w-full border-t-2 border-dashed border-ink/25 pt-3">
              <p className="text-sm text-ink/70">Now you can spell</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2">
                <WordTiles word={first.word} upper={first.cases} size={38} still />
                <TierBadge tier={tierOf(first.word)} />
              </div>
              {fresh.length > 1 && (
                <button
                  type="button"
                  className="mt-2 text-xs font-bold text-teal-ink underline"
                  onClick={() => {
                    g.closeSheet();
                    g.nav("claim");
                  }}
                >
                  and {fresh.length - 1} more new {fresh.length === 2 ? "word" : "words"} on Spell
                </button>
              )}
              <div className="mt-3 flex w-full gap-2">
                <Button variant="ghost" className="shrink-0 px-5" onClick={g.closeSheet}>
                  Later
                </Button>
                {g.canAfford(claim) ? (
                  <Button
                    variant="teal"
                    className="flex-1"
                    onClick={() => {
                      g.closeSheet();
                      g.claim(first.word, first.cases);
                    }}
                  >
                    Claim {first.word} · {fmtWord(claim)}
                  </Button>
                ) : (
                  <Button variant="primary" className="flex-1" onClick={() => g.openSheet({ kind: "balance", need: { amount: claim, action: "a claim" } })}>
                    Get $WORD to claim it
                  </Button>
                )}
              </div>
              <button type="button" className="mt-2.5 w-full text-center text-xs font-bold text-candy-ink underline" onClick={again}>
                or rip {n === 1 ? "a" : "another"} pack · {fmtWord(packPrice)} $WORD
              </button>
            </div>
          ) : (
            <>
              {checking && !plain && (
                <p className="mt-1 text-xs text-ink/55" aria-live="polite">
                  Checking what you can spell now…
                </p>
              )}
              <div className="mt-4 flex w-full gap-2">
                <Button variant="ghost" className="shrink-0 px-5" onClick={() => g.nav("claim")}>
                  Spell
                </Button>
                <Button variant="primary" className="flex-1" onClick={again}>
                  {n === 1 ? "Rip a pack" : "Rip another"} · {fmtWord(packPrice)}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {stuck && !counted && (
        <Button full variant="ghost" className="mt-3" onClick={g.closeSheet}>
          Close
        </Button>
      )}
    </div>
  );
}

/** How long the wait may run before the eyes at the window start to close. */
const DOZE_AFTER_MS = 8200;

/**
 * How rare the best letter is, in the Mint's own numbers (lib/letterOdds), with the chain's supply
 * where the game has it: a sold-out letter leaves the pull, and the rest rise.
 */
function useRarity(pulls: readonly Pull[] | null): { odds: string; packs: number } | null {
  const supply = useLetterSupply(!!pulls?.some((p) => p.best && p.rare));
  const best = pulls?.find((p) => p.best && p.rare);
  if (!best) return null;
  const p = letterOdds(supply.data?.available)[best.idx];
  return p > 0 ? { odds: fmtOdds(p), packs: packsPer(p) } : null;
}

export function MailSheet() {
  const g = useGame();
  const mail = g.mail;
  const title = !mail ? "Mail" : mail.count === 1 ? "Your letter" : mail.free ? "Your free pack" : "Pack of 5";
  return (
    <Sheet open onClose={g.closeSheet} title={title}>
      {mail ? <MailStage key={mail.seq} mail={mail} /> : <p className="py-6 text-center text-ink/60">There’s no mail to open right now.</p>}
    </Sheet>
  );
}
