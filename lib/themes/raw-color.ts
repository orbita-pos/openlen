// A RAW COLOUR, exactly as Claude Code's own validation takes one (`glass.tint`, a still ground's colours, a mod's
// `colors`): #hex of 3, 4, 6 or 8 digits, or `rgb()`, `rgba()`, `hsl()`, `hsla()` of plain numbers (a percent sign
// allowed), comma or space apart, a `/` or `,` before the alpha — and at most 64 characters. Nothing else: no names,
// no `var()`, no `url()`, no `oklch()`. A theme's colours reach the workspace as the values of custom properties in
// a `style`, so what this admits is what that `style` can ever hold.
// Client-safe: no server imports.

export const RAW_COLOR_MAX_LENGTH = 64;

const NUMBER = String.raw`(\d+(\.\d+)?|\.\d+)%?`;
const SEPARATOR = String.raw`( *, *| +)`;

const RAW_COLOR = new RegExp(
  String.raw`^(#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})|(rgb|hsl)a?\( *` +
    `${NUMBER}${SEPARATOR}${NUMBER}${SEPARATOR}${NUMBER}` +
    String.raw`( *[,/] *${NUMBER})? *\))$`,
);

export function isRawColor(s: unknown): s is string {
  return typeof s === "string" && s.length <= RAW_COLOR_MAX_LENGTH && RAW_COLOR.test(s);
}
