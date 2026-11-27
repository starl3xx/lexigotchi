"use client";
/**
 * Whether the card a front is in catches the light right now (cards/SceneCard decides: the card in
 * focus, front up, on screen, its word not hungry, motion welcome). The front draws the light
 * itself, UNDER its letters (SceneFrame, `.cf-light`), so the card tells it through this: a front
 * is handed to a card already made, and a card has no other way in.
 *
 * False everywhere else: a front in a list, on a share page, in a picker draws no light and adds
 * nothing to the page for it.
 */
import { createContext } from "react";

export const CardLit = createContext(false);
