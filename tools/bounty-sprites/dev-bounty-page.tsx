import dynamic from "next/dynamic";
import { BOARDS } from "../../lib/bountyConfig";
const BountyGameView = dynamic(() => import("../../components/BountyHunters/BountyGame"), { ssr: false });
export default function Dev() {
  const n = typeof window !== "undefined" ? parseInt(new URLSearchParams(window.location.search).get("b") || "1", 10) : 1;
  return <BountyGameView board={BOARDS[n - 1] || BOARDS[0]} onEnd={(r) => { (window as any).__end = r; }} onQuit={() => {}} />;
}
