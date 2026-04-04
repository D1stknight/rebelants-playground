import dynamic from "next/dynamic";
import Head from "next/head";

const Shuffle = dynamic(() => import("../components/Shuffle"), { ssr: false });

export default function ShufflePage() {
  return (
    <>
      <Head>
        <title>Shuffle — Rebel Ants Playground</title>
        <meta name="description" content="5 eggs. We shuffle. You pick one for a prize." />
      </Head>
      <Shuffle />
    </>
  );
}
