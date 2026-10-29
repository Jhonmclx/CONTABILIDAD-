// Configuración pública. Se puede sobrescribir sin recompilar con /config.js
// (window.__CD_CONFIG__). La clave publicable es segura en el navegador:
// el acceso a datos lo controlan las políticas RLS del servidor.
const w = (typeof window !== 'undefined' ? (window as any).__CD_CONFIG__ : null) || {};

export const CONFIG = {
  url: (w.supabaseUrl as string) || 'https://mkviobxkrekekzdxmpty.supabase.co',
  anonKey: (w.supabaseKey as string) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rdmlvYnhrcmVrZWt6ZHhtcHR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDQzMjQsImV4cCI6MjEwODgyMDMyNH0.uLcVvjUaInRcxUkhvkvJB9SAjAITGn3zzQIdAzU0nmU',
  siteUrl: (w.siteUrl as string) || (typeof window !== 'undefined' ? window.location.origin : ''),
  defaultBrand: 'CONTABILIDAD DIGITAL',
};
