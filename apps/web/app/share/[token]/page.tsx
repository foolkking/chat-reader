import { ShareReadonlyReader } from "../../../features/sharing/share-readonly-reader";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareReadonlyReader token={token} />;
}
