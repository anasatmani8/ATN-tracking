import type { ExpoConfig } from 'expo/config';

/**
 * Everything brand- or publisher-specific is read from the environment so the
 * working name "Kinset" can be replaced without touching source. See .env.example.
 */
const env = process.env;
const variant = env.APP_VARIANT ?? 'development'; // development | preview | production
const suffix = variant === 'production' ? '' : `.${variant === 'preview' ? 'preview' : 'dev'}`;
const name = env.APP_NAME ?? 'Kinset';
const iosBundleId = (env.IOS_BUNDLE_ID ?? 'com.example.kinset') + suffix;
const androidPackage = (env.ANDROID_PACKAGE ?? 'com.example.kinset') + suffix;

const config: ExpoConfig = {
  name: variant === 'production' ? name : `${name} (${variant === 'preview' ? 'Preview' : 'Dev'})`,
  slug: env.APP_SLUG ?? 'kinset',
  scheme: env.APP_SCHEME ?? 'kinset',
  version: '1.0.0',
  runtimeVersion: { policy: 'appVersion' },
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    icon: './assets/images/icon.png',
    bundleIdentifier: iosBundleId,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: `${name} uses the camera only to scan a food barcode when you choose to. Nothing is recorded or uploaded.`,
    },
  },
  android: {
    package: androidPackage,
    adaptiveIcon: {
      backgroundColor: '#1D4ED8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'com.google.android.gms.permission.AD_ID', 'android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM'],
    // Health data stays out of OS cloud backups; account sync is the opt-in backup path.
    allowBackup: false,
  },
  web: { output: 'single', favicon: './assets/images/favicon.png' },
  plugins: [
    // One bundle on every platform: the app must work fully offline, including on web.
    ['expo-router', { asyncRoutes: false, sitemap: false, headers: { 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Opener-Policy': 'same-origin' } }],
    ['expo-splash-screen', { backgroundColor: '#1D4ED8', image: './assets/images/splash-icon.png', imageWidth: 96 }],
    'expo-sqlite',
    'expo-secure-store',
    'expo-localization',
    ['expo-notifications', { color: '#1D4ED8' }],
    ['expo-camera', { cameraPermission: `${name} uses the camera only to scan a food barcode when you choose to.`, microphonePermission: false, recordAudioAndroid: false }],
    ['expo-font', {}],
  ],
  experiments: { typedRoutes: false },
  extra: {
    variant,
    supportEmail: env.SUPPORT_EMAIL ?? '',
    privacyUrl: env.PRIVACY_URL ?? '',
    termsUrl: env.TERMS_URL ?? '',
    accountDeletionUrl: env.ACCOUNT_DELETION_URL ?? '',
    eas: env.EAS_PROJECT_ID ? { projectId: env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
