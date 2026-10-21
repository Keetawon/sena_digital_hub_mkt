import type { Project } from "./hub-admin";
import { PublicationComparison, publicationChanges } from "./publication-comparison";

export function projectChanges(target: Project, current?: Project) {
  return publicationChanges(target.publication_preview ?? {}, current?.publication_preview).filter(field => field.changed);
}
export function ProjectComparison({ current, target }: { current?: Project; target?: Project }) {
  return <PublicationComparison current={current?.publication_preview} target={target?.publication_preview} redacted={target?.publication_preview_redacted || current?.publication_preview_redacted} label="เปรียบเทียบข้อมูลโครงการ" />;
}
