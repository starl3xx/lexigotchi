/**
 * The phone's tilt, for a live back's light (./LiveMaterial). Android browsers send orientation
 * freely; iOS asks the player first, and only from a tap: the tap that turns a card over asks
 * (`askForTilt`, once a page load), so tilting works without a button of its own. A "no" is
 * remembered for the page; the light then follows the finger instead.
 */
type Permission = "granted" | "denied" | "default";
type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<Permission> };

let asked = false;
let granted: boolean | null = null;

/** Whether orientation events may be listened to now. */
export function tiltAllowed(): boolean {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return false;
  const ios = (DeviceOrientationEvent as IOSOrientation).requestPermission;
  return ios ? granted === true : true;
}

/**
 * From a tap: ask iOS for the tilt, once a page load. Must run inside the tap's handler (iOS
 * refuses a request that isn't). Does nothing where no asking is needed, or where a pointer moves
 * the light (a mouse, a trackpad).
 */
export function askForTilt(): void {
  if (asked || typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return;
  const ios = (DeviceOrientationEvent as IOSOrientation).requestPermission;
  if (!ios || !window.matchMedia("(pointer: coarse)").matches) return;
  asked = true;
  ios
    .call(DeviceOrientationEvent)
    .then((p) => {
      granted = p === "granted";
      if (granted) window.dispatchEvent(new Event("lexi:tilt"));
    })
    .catch(() => {
      granted = false;
    });
}

/** The least the light moves (0–1 across the back) before a tilt draws a frame: about one degree. */
export const TILT_MIN_MOVE = 0.02;
/** The most often a tilt draws: about 30 frames a second, plenty for a soft light. */
export const TILT_MIN_MS = 33;

/**
 * Which tilts draw a frame. A phone in the hand sends orientation all the time, and every reading
 * drawing a frame would make a resting back a loop: a reading draws only once the light has moved
 * about a degree since the last frame, and no sooner than ~33 ms after it. The hand's tremor
 * draws nothing.
 */
export function makeTiltFilter(minMove = TILT_MIN_MOVE, minMs = TILT_MIN_MS, from: readonly [number, number] = REST_LIGHT) {
  // Starts where the light rests, so the first reading draws only if the phone has really moved.
  let last: { x: number; y: number; t: number } | null = { x: from[0], y: from[1], t: -Infinity };
  return (x: number, y: number, now: number): boolean => {
    if (last && Math.abs(x - last.x) < minMove && Math.abs(y - last.y) < minMove) return false;
    if (last && now - last.t < minMs) return false;
    last = { x, y, t: now };
    return true;
  };
}

/** Where the light rests once a back's sweep ends (liveSurface's sweep ends here): a little left of
 *  centre, toward the top. A tilt moves it from here, so the first reading never makes it jump. */
export const REST_LIGHT: readonly [number, number] = [0.45, 0.35];

/**
 * The light from a tilt: tipping the phone left and right moves it across, toward and away moves
 * it up and down, from where it rests (`from`), by how far the phone has turned since it was held
 * at `rest` (its reading when the back's sweep ended).
 */
export function lightFromTilt(
  e: { beta: number | null; gamma: number | null },
  rest: { beta: number; gamma: number },
  from: readonly [number, number] = REST_LIGHT,
): [number, number] {
  const gamma = e.gamma ?? rest.gamma;
  const beta = e.beta ?? rest.beta;
  return [from[0] + (gamma - rest.gamma) / 50, from[1] - (beta - rest.beta) / 50];
}
