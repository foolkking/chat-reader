import { BookOpen, Code2, FlaskConical, Folder, GraduationCap, Star } from "lucide-react";
import type { ProjectRead } from "../../lib/types";

export const projectSymbols = [
  { value: "folder", zh: "文件夹", en: "Folder", icon: Folder },
  { value: "book", zh: "阅读", en: "Reading", icon: BookOpen },
  { value: "code", zh: "代码", en: "Code", icon: Code2 },
  { value: "research", zh: "研究", en: "Research", icon: FlaskConical },
  { value: "study", zh: "学习", en: "Study", icon: GraduationCap },
  { value: "star", zh: "收藏", en: "Favorites", icon: Star },
];

export function ProjectSymbol({ project, className = "h-4 w-4 shrink-0" }: { project?: Pick<ProjectRead, "color" | "icon">; className?: string }) {
  const Icon = projectSymbols.find((item) => item.value === project?.icon)?.icon ?? Folder;
  const color = /^#[0-9a-f]{6}$/i.test(project?.color ?? "") ? project?.color : undefined;
  return <Icon aria-hidden="true" className={className} style={{ color: color ?? "var(--text-secondary)" }} data-project-symbol={project?.icon ?? "folder"} />;
}
