// プロジェクトは 1 人 10 個まで（2026-11-07 オーナーの決定）。DB のトリガー projects_check_limit の c_max_projects と同じ値（20261107130000）
export const MAX_PROJECTS_PER_USER = 10;
export const PROJECT_LIMIT_TEXT = `プロジェクトは 1 人 ${MAX_PROJECTS_PER_USER} 個までです`;

export function projectLimitReached(count: number): boolean {
  return count >= MAX_PROJECTS_PER_USER;
}

// DB が上限で断ったときのエラー（projects_check_limit。message は 'project_limit'）
export function isProjectLimitError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "P0001" && error.message === "project_limit";
}
