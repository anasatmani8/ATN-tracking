import type { ExpoConfig } from 'expo/config';

import settings from './app.settings.json';

/**
 * Everything brand- or publisher-specific lives in app.settings.json (one file, editable on
 * github.com). Environment variables of the same meaning override it for local experiments.
 */
const env = process.env;
const pick = (envValue: string | undefined, fileValue: string) => (envValue && envValue.length > 0 ? envValue : fileValue);
const variant = env.APP_VARIANT ?? 'development'; // development | preview | production
const suffix = variant === 'production' ? '' : `.${variant === 'preview' ? 'preview' : 'dev'}`;
const name = pick(env.APP_NAME, settings.appName);
const iosBundleId = pick(env.IOS_BUNDLE_ID, settings.iosBundleId) + suffix;
const androidPackage = pick(env.ANDROID_PACKAGE, settings.androidPackage) + suffix;
const easProjectId = pick(env.EAS_PROJECT_ID, settings.easProjectId);

const config: ExpoConfig = {
  name: variant === 'production' ? name : `${name} (${variant === 'preview' ? 'Preview' : 'Dev'})`,
  slug: pick(env.APP_SLUG, settings.slug),
  scheme: pick(env.APP_SCHEME, settings.scheme),
  owner: settings.easOwner || undefined,
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
    supportEmail: pick(env.SUPPORT_EMAIL, settings.supportEmail),
    privacyUrl: pick(env.PRIVACY_URL, settings.privacyUrl),
    termsUrl: pick(env.TERMS_URL, settings.termsUrl),
    accountDeletionUrl: pick(env.ACCOUNT_DELETION_URL, settings.accountDeletionUrl),
    eas: easProjectId ? { projectId: easProjectId } : undefined,
  },
};

export default config;
