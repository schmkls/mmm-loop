/** Prompt templating: replace {{name}} placeholders, failing loudly on any
 * placeholder without a value (spec §7). */

export function fillTemplate(template: string, vars: Record<string, string>): string {
  const unknown = new Set<string>();
  const filled = template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name: string) => {
    if (!(name in vars)) {
      unknown.add(name);
      return "";
    }
    return vars[name]!;
  });
  if (unknown.size > 0) {
    throw new Error(
      `Prompt template references unknown variable(s): ${[...unknown].map((n) => `{{${n}}}`).join(", ")}`,
    );
  }
  return filled;
}
