import { createClient } from "@/lib/supabase/server";
import { PDF_BUCKET, createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Streams the rendered PDF after checking membership through RLS. The bucket
 * stays private and no signed URL ever leaves the server, so a link to this
 * route is only useful to someone already on the team.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, meeting_date, pdf_path")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return new Response("Huddle not found.", { status: 404 });
  }
  if (!meeting.pdf_path) {
    return new Response("No PDF for this huddle yet.", { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(PDF_BUCKET)
    .download(meeting.pdf_path);

  if (error || !data) {
    return new Response("Couldn't read the PDF.", { status: 500 });
  }

  return new Response(await data.arrayBuffer(), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="huddle-${meeting.meeting_date}.pdf"`,
      "cache-control": "private, max-age=60",
    },
  });
}
