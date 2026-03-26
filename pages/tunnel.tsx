import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const TunnelShell = dynamic(() => import("../components/TunnelShell"), {
  ssr: false,
});

export default function TunnelPage() {
  return <TunnelShell />;
}
