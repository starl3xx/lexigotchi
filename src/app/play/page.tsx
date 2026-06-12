import type { Metadata } from "next";
import { GameApp } from "@/components/game/GameApp";

export const metadata: Metadata = {
  title: "Lexigotchi — play",
  description: "The playable Lexigotchi prototype — a portrait Farcaster mini-app. No contracts wired; mock state.",
};

export default function PlayPage() {
  return <GameApp />;
}
