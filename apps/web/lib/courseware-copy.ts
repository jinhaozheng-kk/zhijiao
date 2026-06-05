export type CoursewareStatusValue = "DRAFT" | "READY";
export type CoursewareSectionTypeValue =
  | "INTRO"
  | "EXPLANATION"
  | "EXAMPLE"
  | "PITFALL"
  | "EXERCISE";

export function coursewareStatusLabel(status: CoursewareStatusValue): string {
  switch (status) {
    case "DRAFT":
      return "草稿";
    case "READY":
      return "已完成";
  }
}

export function coursewareSectionTypeLabel(type: CoursewareSectionTypeValue): string {
  switch (type) {
    case "INTRO":
      return "课堂导入";
    case "EXPLANATION":
      return "讲解结构";
    case "EXAMPLE":
      return "例题";
    case "PITFALL":
      return "易错点";
    case "EXERCISE":
      return "课堂练习";
  }
}
