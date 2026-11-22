import { ConsentScreen } from "../../../../../../features/browser-extension/consent";
export default async function Page({ params }: {
  params: Promise<{client:string; challenge:string; state:string}>;
}) {
  return <ConsentScreen {...await params} />;
}
