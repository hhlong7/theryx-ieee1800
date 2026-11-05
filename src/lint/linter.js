import { defaultRegistry } from "./checkerRegistry.js";
import "./moduleCheckers.js";

export class Linter {
  registry;
  config;
  constructor(config, registry = defaultRegistry) {
    this.config = config;
    this.registry = registry;
  }
  lint(d, m) {
    let k = [];
    for (let rule of this.config.rules) {
      if (!rule.enabled) {
        continue;
      }
      let value = this.registry.get(rule.checker);
      if (!value) {
        k.push({
          message: `[${rule.id ?? "UNKNOWN"}] Rule '${rule.id ?? "(unnamed)"}' declares checker '${rule.checker ?? "(missing)"}', which is not registered. This rule is not running. Known checkers: ${this.registry.getAllCheckerNames().join(", ")}.`,
          severity: "warning",
          span: this.configErrorSpan(d),
          code: "LINTER-CONFIG",
        });
        continue;
      }
      for (let moduleItem of d.modules) {
        let moduleScope = m.getModuleScope(moduleItem.name);
        let R = {
          ast: d,
          currentModule: moduleItem,
          moduleScope: moduleScope,
          symbolTable: m,
          ruleConfig: rule,
          report: (J, X, Q) => {
            k.push({
              message: `[${rule.id}] ${J}`,
              severity: Q ?? rule.severity,
              span: X,
              code: rule.id,
            });
          },
        };
        try {
          value(R);
        } catch (J) {
          console.error(`Error running linter rule ${rule.id}:`, J);
        }
      }
    }
    return k;
  }
  configErrorSpan(d) {
    let m = {
      line: 1,
      column: 1,
    };
    return {
      fileUri: d.span?.fileUri ?? "",
      start: m,
      end: {
        line: 1,
        column: 1,
      },
    };
  }
}
