declare global {
  interface Window {
    BNTS_GAS?: { baseUrl: string; teacher: boolean };
    google?: { script: { run: any } };
  }
}
export const isAppsScript = !!window.BNTS_GAS;
export const homeUrl = isAppsScript ? window.BNTS_GAS!.baseUrl : "/";
export const isTeacherPage = isAppsScript
  ? window.BNTS_GAS!.teacher
  : location.pathname.replace(/\/$/, "") === "/teacher";
