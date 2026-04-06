// pages/_app.tsx
import "../styles/globals.css";
import "@rainbow-me/rainbowkit/styles.css";

import type { AppProps } from "next/app";
import Head from "next/head";
import { WagmiProvider, http } from "wagmi";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apeChain } from "../lib/apechain";

const queryClient = new QueryClient();

const wagmiConfig = getDefaultConfig({
  appName: "Rebel Ants Playground",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "MISSING_PROJECT_ID",
  chains: [apeChain],
  transports: {
    [apeChain.id]: http(),
  },
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Rebel Ants Playground 🐜</title>

        <meta
          name="description"
          content="Play Rebel Ants mini-games, earn REBEL points, and win NFTs or merch."
        />

        <meta property="og:title" content="Rebel Ants Playground 🐜" />
        <meta
          property="og:description"
          content="Play mini-games. Earn REBEL. Win NFTs and merch."
        />
        <meta
          property="og:image"
          content="https://play.rebelants.io/social-preview.png?v=2"
        />
        <meta property="og:url" content="https://play.rebelants.io" />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Rebel Ants Playground 🐜" />
        <meta
          name="twitter:description"
          content="Play mini-games. Earn REBEL. Win NFTs and merch."
        />
        <meta
          name="twitter:image"
          content="https://play.rebelants.io/social-preview.png?v=2"
        />
      </Head>

      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider>
            <Component {...pageProps} />
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </>
  );
}
