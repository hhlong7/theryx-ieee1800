import * as url from "url";
import * as path from "path";
import { NodeLocator } from "./nodeLocator.js";

export class DefinitionService {
  locator = new NodeLocator();
  findDefinition(d, m, k, E, C, M) {
    let nodeAtPosition = this.locator.findNodeAtPosition(d, k, E);
    if (nodeAtPosition) {
      switch (nodeAtPosition.kind) {
        case "identifier":
          return this.resolveIdentifierDefinition(
            nodeAtPosition.node.name,
            nodeAtPosition.currentModule,
            d,
            m,
            C,
            M,
          );
        case "instance_module":
          return this.resolveModuleDefinition(nodeAtPosition.moduleName, d, C, M);
        case "instance_name":
          return {
            targetUri: C,
            targetSpan: nodeAtPosition.span,
          };
        case "named_port":
          return this.resolveNamedPortDefinition(
            nodeAtPosition.portName,
            nodeAtPosition.instanceNode.moduleName,
            d,
            C,
            M,
          );
        case "module_name":
          return {
            targetUri: C,
            targetSpan: nodeAtPosition.span,
          };
      }
    }
  }
  resolveIdentifierDefinition(d, m, k, E, C, M) {
    let R =
      E.getModuleScope(m.name)?.resolve(d) ??
      E.globalScope.resolve(d) ??
      E.getModuleScope(m.name)?.svLocals?.get(d);
    if (R && R.span) {
      return {
        targetUri: R.span.fileUri || C,
        targetSpan: R.span,
      };
    }
    let J = k.modules.find((X) => X.name === d);
    if (J) {
      return {
        targetUri: J.span.fileUri || C,
        targetSpan: J.nameSpan ?? J.span,
      };
    }
    if (M) {
      let X = M.resolveModule(d, C);
      if (X.found && X.moduleNode && X.filePath) {
        return {
          targetUri: this.filePathToUri(X.filePath),
          targetSpan: X.moduleNode.nameSpan ?? X.moduleNode.span,
        };
      }
    }
  }
  resolveModuleDefinition(d, m, k, E) {
    let C = m.modules.find((M) => M.name === d);
    if (C) {
      return {
        targetUri: C.span.fileUri || k,
        targetSpan: C.nameSpan ?? C.span,
      };
    }
    if (E) {
      let M = E.resolveModule(d, k);
      if (M.found && M.moduleNode && M.filePath) {
        return {
          targetUri: this.filePathToUri(M.filePath),
          targetSpan: M.moduleNode.nameSpan ?? M.moduleNode.span,
        };
      }
    }
  }
  resolveNamedPortDefinition(d, m, k, E, C) {
    let M = k.modules.find((R) => R.name === m);
    let v = E;
    if (!M && C) {
      let R = C.resolveModule(m, E);
      if (R.found && R.moduleNode && R.filePath) {
        M = R.moduleNode;
        v = this.filePathToUri(R.filePath);
      }
    }
    if (M) {
      for (let item of M.items) {
        if (item.kind === "PortDeclaration") {
          for (let identifier of item.identifiers) {
            if (identifier.name === d) {
              return {
                targetUri: v,
                targetSpan: identifier.span,
              };
            }
          }
        }
      }
    }
  }
  filePathToUri(d) {
    try {
      return url.pathToFileURL(path.resolve(d)).toString();
    } catch {
      return d;
    }
  }
}
