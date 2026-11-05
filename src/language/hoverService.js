import * as path from "path";
import * as url from "url";
import { NodeLocator } from "./nodeLocator.js";

export class HoverService {
  locator = new NodeLocator();
  getHoverInfo(d, m, k, E, C, M) {
    let nodeAtPosition = this.locator.findNodeAtPosition(d, k, E);
    if (nodeAtPosition) {
      switch (nodeAtPosition.kind) {
        case "identifier":
          return this.formatIdentifierHover(
            nodeAtPosition.node.name,
            nodeAtPosition.currentModule,
            d,
            m,
            C,
            nodeAtPosition.span,
            M,
          );
        case "instance_module":
          return this.formatInstanceModuleHover(
            nodeAtPosition.moduleName,
            d,
            C,
            nodeAtPosition.span,
            M,
          );
        case "instance_name":
          return this.formatInstanceNameHover(
            nodeAtPosition.instanceName,
            nodeAtPosition.instanceNode,
            d,
            C,
            nodeAtPosition.span,
            M,
          );
        case "named_port":
          return this.formatNamedPortHover(
            nodeAtPosition.portName,
            nodeAtPosition.instanceNode.moduleName,
            nodeAtPosition.instanceNode.instanceName,
            d,
            C,
            nodeAtPosition.span,
            M,
          );
        case "module_name":
          return this.formatModuleDeclarationHover(nodeAtPosition.moduleNode, nodeAtPosition.span);
      }
    }
  }
  formatIdentifierHover(d, m, k, E, C, M, v) {
    let J =
      E.getModuleScope(m.name)?.resolve(d) ??
      E.globalScope.resolve(d) ??
      E.getModuleScope(m.name)?.svLocals?.get(d);
    if (J) {
      return this.formatSymbolHover(J, m.name, M);
    }
    let X = k.modules.find((Q) => Q.name === d);
    if (X) {
      return this.formatModuleDeclarationHover(X, M);
    }
    if (v) {
      let Q = v.resolveModule(d, C);
      if (Q.found && Q.moduleNode) {
        return this.formatModuleDeclarationHover(Q.moduleNode, M, Q.filePath);
      }
    }
  }
  formatSymbolHover(d, m, k) {
    let E = d.bitWidth > 1 ? `[${d.msb}:${d.lsb}] ` : "";
    let C = `${d.bitWidth} ${d.bitWidth > 1 ? "bits" : "bit"}`;
    switch (d.kind) {
      case "port": {
        let M = d.netType ? `${d.netType} ` : "";
        return {
          codeSignature: `(port ${d.direction}) ${M}${E}${d.name}`,
          description: `Port of module **${m}** (${C})

Declared at line ${d.span.start.line}, column ${d.span.start.column}`,
          range: k,
        };
      }
      case "wire":
        return {
          codeSignature: `(wire) ${E}${d.name}`,
          description: `Internal net in module **${m}** (${C})

Declared at line ${d.span.start.line}, column ${d.span.start.column}`,
          range: k,
        };
      case "reg":
        return {
          codeSignature: `(${d.netType ?? "reg"}) ${E}${d.name}`,
          description: `Register / variable in module **${m}** (${C})

Declared at line ${d.span.start.line}, column ${d.span.start.column}`,
          range: k,
        };
      case "parameter": {
        let M = d.value !== undefined ? ` = ${d.value}` : "";
        return {
          codeSignature: `parameter ${d.name}${M}`,
          description: `Parameter constant in module **${m}**

Declared at line ${d.span.start.line}, column ${d.span.start.column}`,
          range: k,
        };
      }
      case "instance":
        return {
          codeSignature: `instance ${d.name}`,
          description: `Module instance in **${m}**

Declared at line ${d.span.start.line}, column ${d.span.start.column}`,
          range: k,
        };
      default:
        return {
          codeSignature: d.name,
          description: `Symbol in module **${m}**`,
          range: k,
        };
    }
  }
  formatInstanceModuleHover(d, m, k, E, C) {
    let M = m.modules.find((R) => R.name === d);
    let v;
    if (!M && C) {
      let R = C.resolveModule(d, k);
      if (R.found && R.moduleNode) {
        M = R.moduleNode;
        v = R.filePath;
      }
    }
    return M
      ? this.formatModuleDeclarationHover(M, E, v)
      : {
          codeSignature: `module ${d}`,
          description: `Unresolved module **${d}**`,
          range: E,
        };
  }
  formatNamedPortHover(d, m, k, E, C, M, v) {
    let R = E.modules.find((Q) => Q.name === m);
    if (!R && v) {
      let Q = v.resolveModule(m, C);
      if (Q.found && Q.moduleNode) {
        R = Q.moduleNode;
      }
    }
    let J = "";
    if (R) {
      for (let item of R.items) {
        if (item.kind === "PortDeclaration" && item.identifiers.find((Qe) => Qe.name === d)) {
          let Qe = "";
          if (
            item.range &&
            item.range.msb.kind === "NumberLiteral" &&
            item.range.lsb.kind === "NumberLiteral"
          ) {
            Qe = `[${item.range.msb.value}:${item.range.lsb.value}] `;
          }
          J = `(port ${item.direction}) ${Qe}.${d}`;
          break;
        }
      }
    }
    return {
      codeSignature: J || `port .${d}`,
      description: `Port connection in instance **${k}** (module **${m}**)`,
      range: M,
    };
  }
  formatInstanceNameHover(d, m, k, E, C, M) {
    let v = k.modules.find((Re) => Re.name === m.moduleName);
    let R;
    if (!v && M) {
      let Re = M.resolveModule(m.moduleName, E);
      if (Re.found && Re.moduleNode) {
        v = Re.moduleNode;
        R = Re.filePath;
      }
    }
    if (!v) {
      return {
        codeSignature: `instance ${d}: ${m.moduleName}`,
        description: `Instance of module **${m.moduleName}** with ${m.portConnections.length} port connection(s). The module could not be resolved, so its signature is unknown.`,
        range: C,
      };
    }
    let describePorts = this.describePorts(v);
    let X =
      describePorts.length > 0
        ? `instance ${d}: ${v.name} (
${describePorts.join(`,
`)}
);`
        : `instance ${d}: ${v.name};`;
    let describeSourceFile = this.describeSourceFile(R, v);
    return {
      codeSignature: X,
      description: `Instance of module **${v.name}** with ${describePorts.length} port(s) and ${m.portConnections.length} connection(s).${describeSourceFile}`,
      range: C,
    };
  }
  describePorts(d) {
    let m = [];
    for (let item of d.items) {
      if (item.kind === "PortDeclaration") {
        let E = "";
        if (
          item.range &&
          item.range.msb.kind === "NumberLiteral" &&
          item.range.lsb.kind === "NumberLiteral"
        ) {
          E = `[${item.range.msb.value}:${item.range.lsb.value}] `;
        }
        for (let identifier of item.identifiers) {
          m.push(`  ${item.direction} ${E}${identifier.name}`);
        }
      }
    }
    return m;
  }
  describeSourceFile(d, m) {
    let k = d ?? this.safeFilePath(m.span.fileUri);
    return k
      ? `

Defined in \`${path.basename(k)}\``
      : "";
  }
  safeFilePath(d) {
    if (d) {
      try {
        return d.startsWith("file://") ? url.fileURLToPath(d) : d;
      } catch {
        return;
      }
    }
  }
  formatModuleDeclarationHover(d, m, k) {
    let describePorts = this.describePorts(d);
    let C = `module ${d.name}`;
    if (describePorts.length > 0) {
      C += ` (
${describePorts.join(`,
`)}
);`;
    } else {
      C += ";";
    }
    let describeSourceFile = this.describeSourceFile(k, d);
    return {
      codeSignature: C,
      description: `Verilog Module with ${describePorts.length} port(s)${describeSourceFile}`,
      range: m,
    };
  }
}
