// Moved into the Hall of Badges (one place for missions and badges).
import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({ redirect: { destination: "/hall?tab=badges", permanent: false } });
export default function Page() { return null; }
