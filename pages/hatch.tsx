import React from "react";
import dynamic from "next/dynamic";
const FactionWars = dynamic(() => import("../components/FactionWars"), { ssr: false });
export default function HatchPage() {
  return <FactionWars />;
}