import { createVersionBucket } from '@utils/semver';
import { tryGetPackageJson } from '@utils/setup-utils';
import { hasDeclaredDependency } from '@utils/package-json';
import { getUI } from '@ui';
import type { WizardRunOptions } from '@utils/types';

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
