import { redirect } from "next/navigation";

export default async function StudyIndex({ params }: PageProps<"/studies/[studyId]">) {
  const { studyId } = await params;
  redirect(`/studies/${studyId}/verify`);
}
