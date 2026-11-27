"use client";
/**
 * A small envelope, sealed and stamped, for the card that says mail is waiting (PendingReveal).
 * The same still pictures as the mail sheet's (lib/cardArt/mail), drawn once and kept. It never
 * moves, and it names no letters: a waiting envelope hasn't been opened. It does show how many
 * are inside, as the real one does: one pair of eyes for a daily letter, five for a pack.
 */
import { ENV, EYES, STAMP, STAMP_PLACE, STRIP, envFront, envStrip, envWindow, eyesArt, mailUri, stampArt } from "@/lib/cardArt/mail";

type Art = { front: string; strip: string; stamp: string; eyes: string };
const art: Partial<Record<1 | 5, Art>> = {};
const ART = (count: 1 | 5): Art =>
  (art[count] ??= {
    front: mailUri(envFront(count), ENV.w, ENV.h),
    strip: mailUri(envStrip(), STRIP.w, STRIP.h),
    stamp: mailUri(stampArt(), STAMP.w, STAMP.h),
    eyes: mailUri(eyesArt("you"), EYES.w, EYES.h),
  });

export function MailThumb({ width = 104, count = 5 }: { width?: number; count?: 1 | 5 }) {
  const a = ART(count);
  const k = width / ENV.w;
  const win = envWindow(count);
  const eyeW = 32 * (width / 328);
  const pitch = 37 * (width / 328);
  const row0 = win.x * k + (win.w * k - ((count - 1) * pitch + eyeW)) / 2;
  const pic = { display: "block", position: "absolute", maxWidth: "none" } as const;
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width, height: ENV.h * k }}>
      {/* eslint-disable @next/next/no-img-element -- still pictures made here, not files to optimise */}
      <img src={a.front} width={width} alt="" draggable={false} style={pic} />
      <img src={a.strip} width={width} alt="" draggable={false} style={pic} />
      <img src={a.stamp} width={STAMP_PLACE.s * k} alt="" draggable={false} style={{ ...pic, left: STAMP_PLACE.x * k, top: STAMP_PLACE.y * k, transform: "rotate(3deg)" }} />
      {Array.from({ length: count }, (_, i) => (
        <img key={i} src={a.eyes} width={eyeW} alt="" draggable={false} style={{ ...pic, left: row0 + i * pitch, top: (win.y + win.h / 2) * k - (eyeW * EYES.h) / EYES.w / 2 }} />
      ))}
      {/* eslint-enable @next/next/no-img-element */}
    </span>
  );
}
