const SEVERITIES = ["error", "warning", "info", "hint"];

export function parseRuleset(O) {
  let parse = JSON.parse(O);
  if (!parse || typeof parse != "object") {
    throw new Error("Ruleset must be a JSON object.");
  }
  if (!Array.isArray(parse.rules)) {
    throw new Error('Ruleset must contain a "rules" array.');
  }
  return {
    version: typeof parse.version == "string" ? parse.version : "1.0.0",
    rules: parse.rules.map((m) => ({
      ...m,
      severity: m.severity,
    })),
  };
}

export function validateRuleset(O, d) {
  let m = [];
  let allCheckerNames = d.getAllCheckerNames();
  for (let rule of O.rules) {
    let C = typeof rule.checker == "string" ? rule.checker.trim() : "";
    if (!C) {
      m.push({
        ruleId: rule.id ?? "(unnamed)",
        checker: "",
        message: `Rule '${rule.id ?? "(unnamed)"}' does not declare a "checker". This rule will never run. Add "checker": "<name>" (one of: ${allCheckerNames.join(", ")}).`,
      });
      continue;
    }
    if (!d.has(C)) {
      m.push({
        ruleId: rule.id ?? "(unnamed)",
        checker: C,
        message: `Rule '${rule.id ?? "(unnamed)"}' declares checker '${C}', which is not registered. This rule will not run. Known checkers: ${allCheckerNames.join(", ")}.`,
      });
      continue;
    }
    if (typeof rule.severity == "string" && !SEVERITIES.includes(rule.severity)) {
      m.push({
        ruleId: rule.id ?? "(unnamed)",
        checker: C,
        message: `Rule '${rule.id ?? "(unnamed)"}' has an invalid severity '${rule.severity}'. Expected one of: ${SEVERITIES.join(", ")}.`,
      });
    }
  }
  return m;
}

export function mergeRulesets(O, d) {
  let m = new Map(O.rules.map((k) => [k.id, k]));
  for (let rule of d.rules) {
    m.set(rule.id, rule);
  }
  return {
    version: d.version ?? O.version,
    rules: [...m.values()],
  };
}

export function findUnknownRulePrefixes(O, d) {
  let m = [];
  for (let rule of O.rules) {
    let E = typeof rule.id == "string" ? rule.id : "";
    if (!d.some((C) => E.startsWith(C))) {
      m.push({
        ruleId: E || "(unnamed)",
        checker: typeof rule.checker == "string" ? rule.checker : "",
        message: `Rule id '${E || "(unnamed)"}' does not start with any of [${d.join(", ")}]. This ruleset file is namespaced; a rule from another catalog belongs in its own file.`,
      });
    }
  }
  return m;
}
