/** Child-process scan entry so a parent can kill a spinning sync loop; usage: tsx scan-probe.no-jest.ts <dir> */
import { scanPostHogSdks } from '../../posthog-sdks';

process.stdout.write(JSON.stringify(scanPostHogSdks(process.argv[2])));
