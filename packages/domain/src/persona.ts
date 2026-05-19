export type Persona = "STUDENT" | "TEACHER" | "PARENT";

export function defaultRouteFor(persona: Persona): string {
  switch (persona) {
    case "STUDENT": return "/";
    case "TEACHER": return "/teacher";
    case "PARENT":  return "/parent";
  }
}
