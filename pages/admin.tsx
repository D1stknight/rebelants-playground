// The Playground's admin lives in the Rebel Console now (Apps → The Playground). Oct 28, 2026.
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: "https://economy.rebelants.io/admin/playground", permanent: false },
});

export default function AdminMoved() {
  return null;
}
