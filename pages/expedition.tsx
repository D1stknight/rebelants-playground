// pages/expedition.tsx
import type { NextPage } from "next";
import Head from "next/head";
import Raid from "../components/Raid";

const ExpeditionPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>The Raid — Rebel Ants Playground</title>
        <meta name="description" content="Assemble 20 ants. Launch a brutal raid. Win loot or die trying." />
      </Head>
      <Raid />
    </>
  );
};

export default ExpeditionPage;
