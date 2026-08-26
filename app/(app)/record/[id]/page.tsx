import { redirect } from "next/navigation";

/** Recording now happens on the one screen. Kept so old links still land. */
export default async function LegacyRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?h=${id}`);
}
