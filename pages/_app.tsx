// pages/_app.tsx
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import PrizeModalHost from '../components/PrizeModalHost';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      {/* Global prize modal listener/host */}
      <PrizeModalHost />
    </>
  );
}
