/** Install the inherited runtime resolution in one Liwa-owned Worker. */

import { getEnvironmentData } from 'node:worker_threads'
import { installRuntimeInterception } from './resolver.ts'
import type { RuntimeResolution } from '../profile.ts'

const registration = getEnvironmentData(
  '@liwa/app-boot/profile-resolution',
) as {
  resolution: RuntimeResolution
} | undefined
if (registration !== undefined) installRuntimeInterception(registration.resolution)
