import { errorTrackingUploadSourceMapsConfig } from '@lib/programs/error-tracking-upload-source-maps/index';

import { nativeCommandFactory } from './factories/native-command-factory';

export const sourceMapsCommand = nativeCommandFactory(
  errorTrackingUploadSourceMapsConfig,
);
