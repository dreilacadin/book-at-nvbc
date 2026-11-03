// The voucher a customer chose on the voucher page ("Book a court with this voucher"), kept on this
// device so the booking form (and My booking) fill it in. Browser only.

const KEY = "nvbc_voucher";

export function loadVoucher(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveVoucher(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* private mode: they can still type it */
  }
}

export function forgetVoucher(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}
