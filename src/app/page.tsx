import { redirect } from "next/navigation";

/** The game is the front door: the bare domain (and the mini-app launch URL) open /play. */
export default function Index() {
  redirect("/play");
}
