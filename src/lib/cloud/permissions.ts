/**
 * Human-readable labels for SharedFolder permission levels.
 */

export type SharePermission = "view" | "upload" | "edit";

/** Full labels — selects, toasts, tooltips. */
export const PERM_LABEL: Record<SharePermission, string> = {
  view: "Просмотр",
  upload: "Загрузка",
  edit: "Изменение",
};

/** Compact chip labels for file grid/list badges. */
export const PERM_LABEL_SHORT: Record<SharePermission, string> = {
  view: "Просмотр",
  upload: "Загрузка",
  edit: "Правка",
};

/** Longer descriptions for permission banners / tooltips. */
export const PERM_DESCRIPTION: Record<SharePermission, string> = {
  view: "Просмотр: вы можете только смотреть и скачивать файлы.",
  upload: "Загрузка: вы можете смотреть, скачивать и добавлять файлы.",
  edit: "Редактирование: вы можете смотреть, скачивать, загружать, переименовывать и удалять файлы внутри этой папки.",
};

export function permLabel(permission: SharePermission | undefined | null): string {
  if (!permission) return "";
  return PERM_LABEL[permission];
}

export function permLabelShort(permission: SharePermission | undefined | null): string {
  if (!permission) return "";
  return PERM_LABEL_SHORT[permission];
}
