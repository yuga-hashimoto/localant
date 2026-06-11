/**
 * Single source of truth for the application version.
 *
 * Kept in sync with the root `package.json` `version` field by the release
 * process (see CONTRIBUTING.md → Releasing). Importing the version from here
 * avoids hardcoded, drifting `"1.0.0"` strings scattered across packages.
 */
export const APP_VERSION = "1.1.0";
