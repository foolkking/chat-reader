import { redirect } from "next/navigation";

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, query = new URLSearchParams();
  for (const key of ["left", "right"]) if (typeof params[key] === "string") query.set(key, params[key]);
  redirect(`/read-together${query.size ? `?${query}` : ""}`);
}
