import { SetMetadata } from '@nestjs/common';

export const SKIP_RATELIMIT = 'skip_ratelimit';

/** Annotate a route or controller to skip the global rate-limit guard. */
export const SkipRateLimit = () => SetMetadata(SKIP_RATELIMIT, true);
