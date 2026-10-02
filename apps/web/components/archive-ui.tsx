import type { BackgroundTaskRead } from "../lib/types";

const active = (task: BackgroundTaskRead) => ["queued", "processing", "cancelling"].includes(task.status);

export function archiveTaskLabel(task: BackgroundTaskRead, zh: boolean) { return task.job_type.endsWith("_archive_export") ? (task.job_type.startsWith("system_") ? (zh ? "系统数据备份" : "System backup") : (zh ? "个人数据备份" : "Personal backup")) : task.job_type.endsWith("_archive_preflight") ? (zh ? "归档内容预检" : "Archive preview") : (task.job_type.startsWith("system_") ? (zh ? "系统归档恢复" : "System restore") : (zh ? "个人归档恢复" : "Personal restore")); }
export function archiveError(message: string, zh: boolean) {
  if (!zh) return message || "The archive operation failed. Refresh and retry.";
  if (/ownership choices changed/i.test(message)) return "另一处操作已更改归属选择，清单已刷新。请重新核对后确认。";
  if (/archived email already exists/i.test(message)) return "归档中的邮箱已存在，请返回归属清单并明确选择已有账户。";
  if (/distinct target|merge.*configuration/i.test(message)) return "这份归档包含账户配置，每个来源账户需要独立的目标账户。请调整归属后重试。";
  if (/target account|mapping target|unresolved/i.test(message)) return "请为所有待确认来源选择有效的目标账户，再开始恢复。";
  if (/empty instance|empty database|customized|personal configuration/i.test(message)) return "当前实例已有资料或自定义配置，不能执行系统恢复。请在空实例恢复。";
  if (/smtp|mail configuration/i.test(message)) return "归档中的策略要求邮箱验证，请先配置当前服务器的邮件服务后再恢复。";
  if (/select a system/i.test(message)) return "请选择管理员导出的系统归档；个人归档请使用「数据与备份」。";
  if (/backup exceeds the configured restore limit/i.test(message)) return "本次备份超出服务器允许恢复的容量，未生成不完整归档。请联系管理员检查归档容量设置后重试。";
  if (/malformed|checksum|invalid|incomplete|missing internal reference/i.test(message)) return "归档损坏或内容不完整，无法安全恢复。请重新选择一份完整归档。";
  if (/select a personal/i.test(message)) return "请选择从个人「数据与备份」导出的归档。系统归档需要使用管理员恢复入口。";
  if (/exceed|too large/i.test(message)) return "归档超过允许的大小，请选择较小的归档文件。";
  if (/expired|no longer available|upload.*unavailable/i.test(message)) return "上传文件已过期或不可用，请重新上传并预检。";
  if (/account.*unavailable|account changed/i.test(message)) return "当前账户无法继续此操作，请重新登录后查看任务状态。";
  if (/different.*options|different backup|already.*confirmed/i.test(message)) return "这份预检已按其他选项确认，请从记录中打开已有恢复任务。";
  if (/cancel or finish/i.test(message)) return "归档任务仍在进行，请完成或取消任务后再移除上传文件。";
  if (/scanner/i.test(message)) return "附件未通过当前扫描策略，恢复已停止。请检查归档文件后重试。";
  if (/changed/i.test(message)) return "归档文件发生变化，请重新上传并预检。";
  if (/upload.*interrupted|fetch|network/i.test(message)) return "网络连接中断，文件选择已保留。请重新连接后重试。";
  return "归档操作未完成，当前资料已保留。请刷新查看任务状态，然后重试或重新上传。";
}
export function archiveStatus(task: BackgroundTaskRead, zh: boolean) { return ({ queued: zh ? "排队中" : "Queued", processing: zh ? "处理中" : "Processing", cancelling: zh ? "取消中" : "Cancelling", cancelled: zh ? "已取消" : "Cancelled", committed: zh ? "已完成" : "Completed", failed: zh ? "失败" : "Failed" })[task.status] ?? task.status; }
export function ArchiveProgress({ task, zh }: { task: BackgroundTaskRead; zh: boolean }) {
  const phases: Record<string, string> = { validating: zh ? "校验归档" : "Validating archive", serializing: zh ? "整理阅读资料" : "Collecting reading materials", assets: zh ? "写入附件" : "Writing attachments", restoring_assets: zh ? "恢复附件" : "Restoring attachments", restoring: zh ? "新增阅读资料" : "Adding reading materials", restoring_configuration: zh ? "恢复配置" : "Restoring configuration", rebuilding: zh ? "重建搜索和目录" : "Rebuilding search and contents", publishing: zh ? "保存结果" : "Saving results" };
  return <div role="status" className="grid gap-2 text-sm text-secondary"><p>{archiveStatus(task, zh)}{active(task) ? ` · ${phases[task.phase] ?? ""} ${task.progress}%` : ""}</p>{active(task) ? <progress aria-label={zh ? "归档任务进度" : "Archive task progress"} max={100} value={task.progress} className="h-2 w-full accent-[var(--accent)]" /> : null}</div>;
}
export function ArchivePreview({ task, zh }: { task: BackgroundTaskRead; zh: boolean }) {
  const counts = task.result.counts ?? {};
  const labels = zh ? ["项目", "对话", "消息版本", "附件", "批注与笔记", "格式、规则与 Skill"] : ["Projects", "Conversations", "Message versions", "Attachments", "Annotations & notes", "Formats, rules & Skills"];
  const values = [counts.projects, counts.conversations, counts.message_versions, counts.attachments, Number(counts.annotations ?? 0) + Number(counts.notebooks ?? 0), Number(counts.profiles ?? counts.import_profiles ?? 0) + Number(counts.rules ?? counts.content_cleanup_rules ?? 0) + Number(counts.skills ?? (Number(counts.user_skills ?? 0) + Number(counts.system_skills ?? 0)))];
  const projects = (task.result.projects ?? []) as Array<{ name: string; archived: boolean }>, conversations = (task.result.conversations ?? []) as Array<{ title: string; archived: boolean }>;
  return <div className="grid gap-3"><p className="text-sm leading-6 text-secondary">{zh ? "完整性校验已通过。请核对将新增的内容：" : "Integrity checks passed. Review the materials to be added:"}</p>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-y border-ui py-3 text-sm">{labels.map((label, index) => <div key={label} className="flex justify-between gap-2"><dt className="text-secondary">{label}</dt><dd className="font-medium tabular-nums text-primary">{Number(values[index] ?? 0)}</dd></div>)}</dl>
    {Number(task.result.missing_attachments) > 0 ? <p role="status" className="text-sm leading-6 text-[var(--warning)]">{zh ? `${task.result.missing_attachments} 个附件缺少文件，只能恢复其引用。` : `${task.result.missing_attachments} attachments have no file. Their references can be restored.`}</p> : null}
    <details className="text-sm text-secondary"><summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">{zh ? "查看项目与对话清单" : "Review projects and conversations"}</summary><div className="max-h-52 overflow-y-auto border-t border-ui py-2"><p className="mb-2 text-xs">{zh ? "各显示前 50 项；恢复覆盖全部已校验内容。" : "Showing up to 50 of each. Restore includes all validated contents."}</p><ul className="grid gap-2">{projects.map((item, index) => <li key={`p-${index}`} className="break-words">{zh ? "项目 · " : "Project · "}{item.name}{item.archived ? (zh ? "（已归档）" : " (archived)") : ""}</li>)}{conversations.map((item, index) => <li key={`c-${index}`} className="break-words">{zh ? "对话 · " : "Conversation · "}{item.title}{item.archived ? (zh ? "（已归档）" : " (archived)") : ""}</li>)}</ul></div></details>
  </div>;
}
