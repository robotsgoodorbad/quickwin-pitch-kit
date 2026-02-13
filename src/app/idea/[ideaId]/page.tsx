import IdeaDetailView from "@/components/IdeaDetailView";

export default async function IdeaPage({
  params,
}: {
  params: Promise<{ ideaId: string }>;
}) {
  const { ideaId } = await params;
  return <IdeaDetailView ideaId={ideaId} />;
}
