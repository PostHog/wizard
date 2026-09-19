import { createVersionBucket } from '../../shared/semver.js';
import { tryGetPackageJson } from '../../shared/setup-utils.js';
import { hasDeclaredDependency } from '../../shared/package-json.js';
import { getUI } from '../../ui/index.js';
import type { WizardRunOptions } from '../../shared/types.js';

export const getReactNativeVersionBucket = createVersionBucket();

export enum ReactNativeVariant {
  EXPO = 'expo',
  REACT_NATIVE = 'react-native',
}

export function getReactNativeVariantName(variant: ReactNativeVariant): string {
  return variant === ReactNativeVariant.EXPO ? 'Expo' : 'React Native';
}

export async function detectReactNativeVariant(
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<ReactNativeVariant> {
  const packageJson = await tryGetPackageJson(options);

  if (packageJson && hasDeclaredDependency('expo', packageJson)) {
    getUI().setDetectedFramework(
      `${getReactNativeVariantName(ReactNativeVariant.EXPO)} 📱`,
    );
    return ReactNativeVariant.EXPO;
  }

  getUI().setDetectedFramework(
    `${getReactNativeVariantName(ReactNativeVariant.REACT_NATIVE)} 📱`,
  );
  return ReactNativeVariant.REACT_NATIVE;
}
