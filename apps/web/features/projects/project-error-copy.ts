import { ApiRequestError } from "../../lib/api";

export type ProjectMutationOperation = "create" | "save" | "move" | "reorder";

export function projectMutationError(error: unknown, zh: boolean, operation: ProjectMutationOperation): string {
  const status = error instanceof ApiRequestError ? error.status : null;
  const raw = error instanceof Error ? error.message.toLowerCase() : "";
  const duplicateName = raw.includes("project name already exists") || raw.includes("同名项目");

  if (duplicateName) {
    return zh ? "已有同名项目，请换一个名称。" : "A project with this name already exists. Choose another name.";
  }
  if (status === 401 || status === 403) {
    if (operation === "save") return zh ? "当前账户无法修改此项目；你的修改仍保留。" : "Your account cannot edit this project. Your changes are retained.";
    if (operation === "move" || operation === "reorder") return zh ? "当前账户无法调整项目，请刷新列表后重试。" : "Your account cannot change this project arrangement. Refresh the list and retry.";
    return zh ? "当前账户无法创建项目，请刷新后重试。" : "Your account cannot create a project. Refresh and retry.";
  }
  if (status === 404) {
    if (operation === "save") return zh ? "此项目已不存在或无法访问；你的修改仍保留。" : "This project no longer exists or is unavailable. Your changes are retained.";
    if (operation === "move" || operation === "reorder") return zh ? "项目或对话已不存在，请刷新列表后重试。" : "The project or conversation is unavailable. Refresh the list and retry.";
    return zh ? "项目已不可用，请刷新列表后重试。" : "The project is unavailable. Refresh the list and retry.";
  }
  if (status === 409 || raw.includes("revision conflict") || raw.includes("其他操作中更新")) {
    if (operation === "save") return zh ? "项目刚刚发生了变化，请刷新后重试；你的修改仍保留。" : "The project changed just now. Refresh and retry; your changes are retained.";
    if (operation === "move") return zh ? "对话或项目刚刚发生了变化，请刷新后重试。" : "The conversation or project changed just now. Refresh and retry.";
    if (operation === "reorder") return zh ? "项目顺序刚刚发生了变化，请刷新后重试。" : "The project order changed just now. Refresh and retry.";
    return zh ? "项目状态刚刚发生了变化，请刷新后重试。" : "The project state changed just now. Refresh and retry.";
  }
  if (status === 400 || status === 422) {
    if (operation === "save") return zh ? "项目设置未保存，请检查内容后重试；你的修改仍保留。" : "Project settings were not saved. Check the values and retry; your changes are retained.";
    if (operation === "move" || operation === "reorder") return zh ? "这次项目操作未被接受，请刷新列表后重试。" : "This project operation was not accepted. Refresh the list and retry.";
    return zh ? "项目未创建，请检查名称后重试。" : "The project was not created. Check the name and retry.";
  }
  if (operation === "save") return zh ? "暂时无法保存项目设置，请检查连接后重试；你的修改仍保留。" : "Project settings could not be saved right now. Check your connection and retry; your changes are retained.";
  if (operation === "move") return zh ? "暂时无法移动对话，请检查连接后重试。" : "The conversation could not be moved right now. Check your connection and retry.";
  if (operation === "reorder") return zh ? "暂时无法调整项目顺序，请检查连接后重试。" : "The project order could not be changed right now. Check your connection and retry.";
  return zh ? "暂时无法创建项目，请检查连接后重试。" : "The project could not be created right now. Check your connection and retry.";
}
