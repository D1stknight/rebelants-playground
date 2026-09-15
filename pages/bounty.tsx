// pages/bounty.tsx
import type { NextPage } from "next";
import Head from "next/head";
import dynamic from "next/dynamic";

const BountyHunters = dynamic(() => import("../components/BountyHunters/BountyHunters"), { ssr: false });

const BountyPage: NextPage = () => (
  <>
    <Head>
      <title>Bounty Hunters — Rebel Ants Playground</title>
      <meta name="description" content="Run and gun through four boards of the corrupted hive. Take the boss's head, collect the bounty." />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    </Head>
    <BountyHunters />
  </>
);

export default BountyPage;
