// Fixture: false-positive guard. `better-auth-utils` is a fictional
// hyphen-name shadow; must NOT match the `better-auth` AUTH_PATTERN.
import { something } from "better-auth-utils";
// Also a non-import string mention; must not match auth patterns either.
const note = "see better-auth docs";
export { something, note };
