/**
 * Password policy.
 *
 * Centralised so all 4 password-setting routes (register, profile/password,
 * admin reset-password, admin user-create) share the same rules.
 *
 * Policy:
 *   - min 8 chars (was min 6 — too short for an admin-bearing app)
 *   - max 200 chars (defence against argon2 DoS via huge inputs)
 *   - at least one letter and one non-letter (digit or symbol)
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function isValidPassword(pw: string): { ok: true } | { ok: false; reason: string } {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) {
    return { ok: false, reason: `Минимум ${PASSWORD_MIN} символов` };
  }
  if (pw.length > PASSWORD_MAX) {
    return { ok: false, reason: `Максимум ${PASSWORD_MAX} символов` };
  }
  const hasLetter = /\p{L}/u.test(pw);
  const hasNonLetter = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/u.test(pw);
  if (!hasLetter || !hasNonLetter) {
    return {
      ok: false,
      reason: "Пароль должен содержать буквы и хотя бы одну цифру или символ",
    };
  }
  return { ok: true };
}
