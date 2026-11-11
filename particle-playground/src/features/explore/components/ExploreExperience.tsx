"use client";

import { useState } from "react";
import { GestureGuide } from "@/features/explore/components/GestureGuide";
import { ParticleScene } from "@/features/explore/components/particles/ParticleScene";

type ExploreStep = "guide" | "play";

/**
 * Explore Galaxies journey: gesture guide, then the existing particle world.
 */
export function ExploreExperience() {
  const [step, setStep] = useState<ExploreStep>("guide");

  if (step === "guide") {
    return <GestureGuide onContinue={() => setStep("play")} />;
  }

  return <ParticleScene />;
}
