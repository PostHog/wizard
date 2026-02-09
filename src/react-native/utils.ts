import { createVersionBucket } from '../utils/semver';
import { tryGetPackageJson } from '../utils/clack-utils';
import { hasPackageInstalled } from '../utils/package-json';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';

export const getReactNativeVersionBucket = createVersionBucket();

export enum ReactNativeVariant {
  EXPO = 'expo',
  REACT_NATIVE = 'react-native',
}

export function getReactNativeVariantName(variant: ReactNativeVariant): string {
  return variant === ReactNativeVariant.EXPO ? 'Expo' : 'React Native';
}

export async function detectReactNativeVariant(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<ReactNativeVariant> {
  const packageJson = await tryGetPackageJson(options);

  if (packageJson && hasPackageInstalled('expo', packageJson)) {
    clack.log.info(
      `Detected ${getReactNativeVariantName(ReactNativeVariant.EXPO)} 📱`,
    );
    return ReactNativeVariant.EXPO;
  }

  clack.log.info(
    `Detected ${getReactNativeVariantName(ReactNativeVariant.REACT_NATIVE)} 📱`,
  );
  return ReactNativeVariant.REACT_NATIVE;
}
