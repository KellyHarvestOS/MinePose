export type ToolId = "avatar" | "heading" | "banner" | "circle";

export const TOOL_LINKS: { id: ToolId; label: string }[] = [
  { id: "avatar", label: "Создатель аватарок" },
  { id: "heading", label: "Генератор заголовков" },
  { id: "banner", label: "Мастерская флагов" },
  { id: "circle", label: "Пиксельные круги" },
];
