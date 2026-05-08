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

          {/* Viewport — critical for mobile */}
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />

          {/* PWA */}
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <meta name="apple-mobile-web-app-title" content="Rebel Ants" />
          <meta name="theme-color" content="#09090b" />
          <link rel="manifest" href="/manifest.json" />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/icon-192.png" />
          <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
          <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />

        <meta
          name="description"
          content="Play Rebel Ants mini-games, earn REBEL points, and win NFTs or merch."
        />

        <meta property="og:title" content="Rebel Ants Playground 🐜" key="og:title" />
        <meta property="og:description" content="Play mini-games. Earn REBEL. Win NFTs and merch." key="og:description" />
        <meta property="og:image" content="https://play.rebelants.io/social_preview_final.PNG?v=3" key="og:image" />
        {/* Explicit og:image dimensions — REQUIRED by WhatsApp link previews
            (they silently drop images without explicit width/height). The image
            is 1200×630 (standard OpenGraph aspect ratio). If you swap the
            image for one of different dimensions, update these numbers. */}
        <meta property="og:image:secure_url" content="https://play.rebelants.io/social_preview_final.PNG?v=3" key="og:image:secure_url" />
        <meta property="og:image:type" content="image/png" key="og:image:type" />
        <meta property="og:image:width" content="1200" key="og:image:width" />
        <meta property="og:image:height" content="630" key="og:image:height" />
        <meta property="og:image:alt" content="Rebel Ants Playground — play, earn REBEL, win NFTs" key="og:image:alt" />
        <meta property="og:url" content="https://play.rebelants.io" key="og:url" />
        <meta property="og:type" content="website" key="og:type" />

        <meta name="twitter:card" content="summary_large_image" key="twitter:card" />
        <meta name="twitter:title" content="Rebel Ants Playground 🐜" key="twitter:title" />
        <meta name="twitter:description" content="Play mini-games. Earn REBEL. Win NFTs and merch." key="twitter:description" />
        <meta name="twitter:image" content="https://play.rebelants.io/social_preview_final.PNG?v=3" key="twitter:image" />
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
