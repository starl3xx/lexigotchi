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

/**
 * The light from a tilt: tipping the phone left and right moves it across, toward and away moves
 * it up and down, around how the phone was held when the back came up (`rest`).
 */
export function lightFromTilt(e: { beta: number | null; gamma: number | null }, rest: { beta: number }): [number, number] {
  const gamma = e.gamma ?? 0;
  const beta = e.beta ?? rest.beta;
  return [0.5 + gamma / 50, 0.5 - (beta - rest.beta) / 50];
}
