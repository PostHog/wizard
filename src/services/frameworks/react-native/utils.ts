import { createVersionBucket } from '@utils/semver';
import { tryGetPackageJson } from '@utils/setup-utils';
import { hasDeclaredDependency } from '@utils/package-json';
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
    return ReactNativeVariant.EXPO;
  }

  return ReactNativeVariant.REACT_NATIVE;
}
