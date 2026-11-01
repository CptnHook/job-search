import type { Platform } from "../boards.js"
import { a16z } from "./a16z.js"
import { getro } from "./getro.js"
import { greylock } from "./greylock.js"
import type { PlatformAdapter } from "./types.js"

export const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = { getro, a16z, greylock }
