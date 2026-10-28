import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { withStudyLock } from "@/db/client";
import { getStudy } from "@/db/queries";
import { importMappingSchema } from "@/import/mapping";
import { ImportError, importCsv } from "@/import/service";
import { MAX_CSV_BYTES } from "@/lib/csv";
import { rateLimitAction, RateLimitError } from "@/lib/rate-limit";
import { currentWorkspace, reviewerName } from "@/lib/session";

export const maxDuration = 60;

export async function POST(request: Request, context: RouteContext<"/api/studies/[studyId]/import">) {
  const { studyId } = await context.params;
  const workspace = await currentWorkspace();
  const study = workspace ? await getStudy(workspace.id, studyId) : null;
  if (!workspace || !study) {
    return NextResponse.json({ problems: ["Study not found."] }, { status: 404 });
  }
  try {
    await rateLimitAction("import", workspace.id, 20, 3600);
    const form = await request.formData();
    const file = form.get("file");
    const mappingRaw = form.get("mapping");
    const fileName = String(form.get("fileName") ?? "responses.csv").slice(0, 200);
    if (!(file instanceof Blob) || typeof mappingRaw !== "string") {
      return NextResponse.json({ problems: ["The upload was incomplete."] }, { status: 400 });
    }
    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ problems: ["The column mapping was not valid."] }, { status: 400 });
    }
    const mapping = importMappingSchema.safeParse(mappingJson);
    if (!mapping.success) {
      return NextResponse.json({ problems: ["The column mapping was not valid."] }, { status: 400 });
    }
    let bytes: Buffer;
    try {
      bytes = gunzipSync(Buffer.from(await file.arrayBuffer()), { maxOutputLength: MAX_CSV_BYTES + 1 });
    } catch {
      return NextResponse.json({ problems: [`The file could not be read, or it is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.`] }, { status: 400 });
    }
    const actor = (await reviewerName()) ?? study.piName;
    const summary = await withStudyLock(study.id, (tx) => importCsv(tx, study, actor, fileName, new Uint8Array(bytes), mapping.data));
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ problems: error.problems }, { status: 422 });
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json({ problems: [error.message] }, { status: 429 });
    }
    throw error;
  }
}
