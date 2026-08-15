import { ShareReadonlyReader } from "../../../features/sharing/share-readonly-reader";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareReadonlyReader token={token} />;
}
