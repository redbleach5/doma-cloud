/**
 * Run an async action over many ids; toast aggregate outcome.
 */
export async function runBulkActions(
  ids: string[],
  action: (id: string) => Promise<unknown>,
  _labels: { successOne: string; successMany: (n: number) => string; fail: string }
): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      await action(id);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail };
}

export function toastBulkResult(
  toast: { success: (m: string) => void; error: (m: string) => void; message: (m: string) => void },
  result: { ok: number; fail: number },
  labels: { one: string; many: (n: number) => string; partial: (ok: number, fail: number) => string }
) {
  if (result.ok === 0 && result.fail === 0) return;
  if (result.fail === 0) {
    toast.success(result.ok === 1 ? labels.one : labels.many(result.ok));
    return;
  }
  if (result.ok === 0) {
    toast.error(labels.partial(0, result.fail));
    return;
  }
  toast.message(labels.partial(result.ok, result.fail));
}
