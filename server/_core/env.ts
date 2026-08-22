export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Konto serwisowe Google (Drive API) — automatyczny podfolder ze
  // zdjęciami dla każdej nowej budowy. Patrz server/_core/googleDrive.ts.
  googleDriveServiceAccountEmail:
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL ?? "",
  googleDriveServiceAccountPrivateKey:
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "",
  googleDriveParentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ?? "",
};
