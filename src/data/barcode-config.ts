import { disabledProvider, openFoodFactsProvider, type BarcodeProvider } from './barcode';

/** Live lookups stay off unless the publisher enables a reviewed provider at build time. */
export function configuredProvider(): BarcodeProvider {
  return process.env.EXPO_PUBLIC_BARCODE_PROVIDER === 'openfoodfacts' ? openFoodFactsProvider() : disabledProvider;
}
