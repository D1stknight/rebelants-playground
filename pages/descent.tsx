// pages/descent.tsx
import type { NextPage } from "next";
import Head from "next/head";
import dynamic from "next/dynamic";

// Lazy-load the heavy 3D shell so the route compiles even before the engine lands
const HiveDescent = dynamic(() => import("../components/HiveDescent/HiveDescent"), { ssr: false });

const DescentPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>The Hive Descent — Rebel Ants Playground</title>
        <meta name="description" content="Descend through 10 floors of a corrupted hive. Face the Queen. Win or die." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <HiveDescent />
    </>
  );
};

export default DescentPage;
