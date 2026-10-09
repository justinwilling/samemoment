// Replace these entries before publishing. Prefer environment variables in production.
export const legalConfig = {
  operator: import.meta.env.VITE_LEGAL_OPERATOR || "Justin Willing",
  address: import.meta.env.VITE_LEGAL_ADDRESS || "Taubenstraße 12 · 40479 Düsseldorf",
  email: import.meta.env.VITE_LEGAL_EMAIL || "justin.willing@web.de",
  phone: import.meta.env.VITE_LEGAL_PHONE || "",
  register: import.meta.env.VITE_LEGAL_REGISTER || "",
  vatId: import.meta.env.VITE_LEGAL_VAT_ID || "",
  updatedAt: "9. Oktober 2026",
};
export const hasLegalContact = Boolean(legalConfig.email);
