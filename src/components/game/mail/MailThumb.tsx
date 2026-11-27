"use client";
/**
 * A small envelope, sealed and stamped, for the card that says mail is waiting (PendingReveal).
 * The same still pictures as the mail sheet's (lib/cardArt/mail), drawn once and kept. It never
 * moves, and it names no letters: a waiting envelope hasn't been opened.
 */
import { ENV, EYES, STAMP, STAMP_PLACE, STRIP, envFront, envStrip, envWindow, eyesArt, mailUri, stampArt } from "@/lib/cardArt/mail";

let art: { front: string; strip: string; stamp: string; eyes: string } | null = null;
const ART = () =>
  (art ??= {
    front: mailUri(envFront(5), ENV.w, ENV.h),
    strip: mailUri(envStrip(), STRIP.w, STRIP.h),
    stamp: mailUri(stampArt(), STAMP.w, STAMP.h),
    eyes: mailUri(eyesArt("you"), EYES.w, EYES.h),
  });

export function MailThumb({ width = 104 }: { width?: number }) {
  const a = ART();
  const k = width / ENV.w;
  const win = envWindow(5);
  const eyeW = 32 * (width / 328);
  const pitch = 37 * (width / 328);
  const row0 = win.x * k + (win.w * k - (4 * pitch + eyeW)) / 2;
  const pic = { display: "block", position: "absolute", maxWidth: "none" } as const;
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width, height: ENV.h * k }}>
      {/* eslint-disable @next/next/no-img-element -- still pictures made here, not files to optimise */}
      <img src={a.front} width={width} alt="" draggable={false} style={pic} />
      <img src={a.strip} width={width} alt="" draggable={false} style={pic} />
      <img src={a.stamp} width={STAMP_PLACE.s * k} alt="" draggable={false} style={{ ...pic, left: STAMP_PLACE.x * k, top: STAMP_PLACE.y * k, transform: "rotate(3deg)" }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <img key={i} src={a.eyes} width={eyeW} alt="" draggable={false} style={{ ...pic, left: row0 + i * pitch, top: (win.y + win.h / 2) * k - (eyeW * EYES.h) / EYES.w / 2 }} />
      ))}
      {/* eslint-enable @next/next/no-img-element */}
    </span>
  );
}
