// pages/expedition.tsx
import type { NextPage } from "next";
import Head from "next/head";
import Raid from "../components/Raid";

const ExpeditionPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>The Raid — Rebel Ants Playground</title>
        <meta name="description" content="Assemble your squad. Launch a raid. Win loot." />
      </Head>
      <Raid />
    </>
  );
};

export default ExpeditionPage;
