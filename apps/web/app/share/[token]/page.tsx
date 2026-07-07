import { ShareReadonlyReader } from "../../../features/sharing/share-readonly-reader";

export default function SharePage({ params }: { params: { token: string } }) {
  return <ShareReadonlyReader token={params.token} />;
}
