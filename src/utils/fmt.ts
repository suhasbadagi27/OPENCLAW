/**
 * fmt.ts — OpenClaw Unified Message Formatter
 *
 * The single source of truth for all outgoing Telegram message formatting.
 * All agents and the orchestrator compose messages exclusively through these helpers.
 * Produces Telegram legacy Markdown (parse_mode: 'Markdown').
 *
 * Visual hierarchy rules:
 *   header()  →  Bold title + optional subtitle + divider
 *   section() →  Titled block with indented content lines
 *   field()   →  "  Label: Value" row (indented)
 *   bullet()  →  Indented bullet list
 *   numbered()→  Indented numbered list
 *   divider() →  Full-width separator line
 *   footer()  →  Italic hint at the bottom of a message
 *   quote()   →  Styled quotation of original text
 *   status()  →  ✅ / ❌ labelled status row
 */

// ─── Separator Lines ──────────────────────────────────────────────────────────

const DIVIDER = '─────────────────────────────────────';
const THIN = '──────────────────────';

// ─── Inline Formatters ────────────────────────────────────────────────────────

/** Bold text */
export const bold = (t: string) => `*${t}*`;

/** Italic text */
export const italic = (t: string) => `_${t}_`;

/** Inline monospace */
export const code = (t: string) => `\`${t}\``;

/** Multiline code block */
export const codeBlock = (t: string) => `\`\`\`\n${t}\n\`\`\``;

// ─── Block Builders ───────────────────────────────────────────────────────────

/** Full-width divider line */
export const divider = () => DIVIDER;

/** Short divider */
export const thinDivider = () => THIN;

/**
 * Message header block.
 * Renders: bold title, optional italic subtitle, then a full divider.
 */
export const header = (title: string, subtitle?: string): string => {
  const parts = [`*${title}*`];
  if (subtitle) parts.push(`_${subtitle}_`);
  parts.push(DIVIDER);
  return parts.join('\n');
};

/**
 * Named section block.
 * Renders: bold section title followed by indented content lines.
 */
export const section = (title: string, lines: string[]): string =>
  [`*${title}*`, ...lines].join('\n');

/** A single "  Label: *Value*" field row */
export const field = (label: string, value: string): string =>
  `  ${label}: *${value}*`;

/** A single "  ✅/❌ Label" status row */
export const status = (label: string, ok: boolean): string =>
  `  ${ok ? '✅' : '❌'} ${label}`;

/** Italic footer hint */
export const footer = (hint: string): string => `_${hint}_`;

/** Quoted original text — used for reprinting the original message in drafts */
export const quote = (text: string, maxLen = 220): string => {
  const trimmed = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  return `❝ ${trimmed} ❞`;
};

/** Indented bullet list */
export const bullet = (items: string[]): string =>
  items.map((i) => `  • ${i}`).join('\n');

/** Indented numbered list */
export const numbered = (items: string[]): string =>
  items.map((item, idx) => `  ${idx + 1}. ${item}`).join('\n');

/** Action row — command + description, aligned for HELP menus */
export const command = (cmd: string, desc: string): string =>
  `  *${cmd.padEnd(22)}*  ${desc}`;

// ─── Composer ─────────────────────────────────────────────────────────────────

/**
 * Join an array of line strings into a single message.
 * Pass empty strings '' to produce blank separator lines.
 */
export const build = (...parts: string[]): string => parts.join('\n');

// ─── Convenience Re-exports ───────────────────────────────────────────────────

export const fmt = {
  bold,
  italic,
  code,
  codeBlock,
  divider,
  thinDivider,
  header,
  section,
  field,
  status,
  footer,
  quote,
  bullet,
  numbered,
  command,
  build,
};

export default fmt;
