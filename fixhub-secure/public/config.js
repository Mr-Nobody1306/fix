/* ServePoint public settings — safe to ship. These three keys are PUBLIC BY
   DESIGN (Supabase anon + Paystack public key are enforced server-side by
   RLS / dashboard settings). The Groq key is NOT here — it lives in the
   server's .env and the browser never sees it. Fill in the placeholders. */
window.FIXHUB_CONFIG = {
supabaseUrl: "https://eobiyeprllkkkmxwcngk.supabase.co",
  supabaseAnonKey: "sb_publishable_PsxILpZo2MKiDXI007rDgw_p6YWWZy7",
  paystackPublicKey: "pk_live_e8f1f9deb4f52160339981feb63f2ce0b92ca8f0"
};
