import * as vscode from "vscode";

const SEMANTIC_THEMES = {
  "theryx-dark": {
    id: "theryx-dark",
    label: "Theryx Modern (Default)",
    description: "Neon Cyan (Clock), Coral (Reset), Magenta (Reg), Mint (Wire) and Gold (Outputs)",
    rules: {
      clock: {
        foreground: "#00E5FF",
        bold: true,
      },
      reset: {
        foreground: "#FF6E40",
        bold: true,
      },
      reg: {
        foreground: "#E040FB",
        italic: true,
      },
      wire: {
        foreground: "#69F0AE",
      },
      portInput: {
        foreground: "#82AAFF",
        bold: true,
      },
      portOutput: {
        foreground: "#FFD740",
        bold: true,
      },
      portInout: {
        foreground: "#FFAB40",
      },
      verilogParameter: {
        foreground: "#F0F4F8",
        bold: true,
      },
      moduleDef: {
        foreground: "#7C4DFF",
        bold: true,
      },
      moduleInstance: {
        foreground: "#B388FF",
      },
    },
  },
  "industrial-eda": {
    id: "industrial-eda",
    label: "Industrial EDA",
    description: "Established industrial EDA color scheme (Orange Clock, Red Reset, Blue Reg)",
    rules: {
      clock: {
        foreground: "#FF9900",
        bold: true,
      },
      reset: {
        foreground: "#FF3333",
        bold: true,
      },
      reg: {
        foreground: "#3399FF",
      },
      wire: {
        foreground: "#00CC66",
      },
      portInput: {
        foreground: "#00BFFF",
      },
      portOutput: {
        foreground: "#FFB90F",
        bold: true,
      },
      portInout: {
        foreground: "#FF7F00",
      },
      verilogParameter: {
        foreground: "#CD9B1D",
        bold: true,
      },
      moduleDef: {
        foreground: "#87CEFA",
        bold: true,
      },
      moduleInstance: {
        foreground: "#98F5FF",
      },
    },
  },
  "high-contrast-pedagogic": {
    id: "high-contrast-pedagogic",
    label: "High Contrast (Pedagogic & Presentations)",
    description: "Primary high-contrast colors ideal for projectors and circuit teaching",
    rules: {
      clock: {
        foreground: "#FFFF00",
        bold: true,
      },
      reset: {
        foreground: "#FF0055",
        bold: true,
      },
      reg: {
        foreground: "#FF00FF",
        bold: true,
      },
      wire: {
        foreground: "#00FF66",
        bold: true,
      },
      portInput: {
        foreground: "#00FFFF",
        bold: true,
      },
      portOutput: {
        foreground: "#FFAA00",
        bold: true,
      },
      portInout: {
        foreground: "#FF8800",
        bold: true,
      },
      verilogParameter: {
        foreground: "#FFFFFF",
        bold: true,
      },
      moduleDef: {
        foreground: "#AA66FF",
        bold: true,
      },
      moduleInstance: {
        foreground: "#FFFFFF",
      },
    },
  },
  "sync-vs-comb": {
    id: "sync-vs-comb",
    label: "Synchronous vs. Combinational (Architectural Focus)",
    description:
      "Warm tones for synchronous elements (Clock/Reg) and cool tones for combinational logic (Wire)",
    rules: {
      clock: {
        foreground: "#FF3366",
        bold: true,
      },
      reset: {
        foreground: "#FF9933",
        bold: true,
      },
      reg: {
        foreground: "#FF007F",
        bold: true,
      },
      wire: {
        foreground: "#00E5FF",
      },
      portInput: {
        foreground: "#66B2FF",
      },
      portOutput: {
        foreground: "#99FF99",
        bold: true,
      },
      portInout: {
        foreground: "#B2B2B2",
      },
      verilogParameter: {
        foreground: "#FFCC00",
        bold: true,
      },
      moduleDef: {
        foreground: "#D8BFD8",
        bold: true,
      },
      moduleInstance: {
        foreground: "#E6E6FA",
      },
    },
  },
};

const THEME_TOKEN_TYPES = Array.from(
  new Set(Object.values(SEMANTIC_THEMES).flatMap((O) => Object.keys(O.rules))),
);

export class SemanticThemeManager {
  static async applyTheme(d, m) {
    let k = SEMANTIC_THEMES[d] ?? SEMANTIC_THEMES["theryx-dark"];
    let configuration = vscode.workspace.getConfiguration("editor");
    if (!vscode.workspace.getConfiguration("theryx").get("semanticTheme.applyToWorkspace", true)) {
      m?.appendLine(
        '[Semantic Theme] Skipped: "theryx.semanticTheme.applyToWorkspace" is disabled by the user.',
      );
      return;
    }
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      m?.appendLine(
        "[Semantic Theme] Skipped: no workspace folder is open, so workspace settings cannot be written.",
      );
      return;
    }
    let inspect = configuration.inspect("semanticHighlighting.enabled");
    if (
      (inspect?.workspaceFolderValue ??
        inspect?.workspaceValue ??
        inspect?.globalValue ??
        inspect?.defaultValue) === false
    ) {
      m?.appendLine(
        '[Semantic Theme] Semantic highlighting is disabled in settings; theme colours were not applied. Enable "editor.semanticHighlighting.enabled" to use hardware themes.',
      );
      return;
    }
    let inspect2 = configuration.inspect("semanticTokenColorCustomizations");
    let X = {
      ...(inspect2?.workspaceValue ?? inspect2?.workspaceFolderValue ?? {}),
    };
    let Q = {
      ...(X.rules ?? {}),
    };
    if (SemanticThemeManager.isLegacyOwnedParameterRule(Q.parameter)) {
      delete Q.parameter;
    }
    SemanticThemeManager.removeOwnedVerilogScope(X);
    for (let [Qe, le] of Object.entries(k.rules)) {
      Q[Qe] = le;
    }
    let Re = {
      ...X,
      rules: Q,
    };
    if (
      inspect?.workspaceValue === undefined &&
      inspect?.workspaceFolderValue === undefined &&
      inspect?.globalValue === undefined
    ) {
      await configuration.update(
        "semanticHighlighting.enabled",
        true,
        vscode.ConfigurationTarget.Workspace,
      );
    }
    await configuration.update(
      "semanticTokenColorCustomizations",
      Re,
      vscode.ConfigurationTarget.Workspace,
    );
    m?.appendLine(
      `[Semantic Theme] Theme '${k.label}' applied to workspace settings (user settings untouched).`,
    );
  }
  static async resetTheme(d) {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      d?.appendLine("[Semantic Theme] Nothing to reset: no workspace folder is open.");
      return;
    }
    let configuration = vscode.workspace.getConfiguration("editor");
    let inspect = configuration.inspect("semanticTokenColorCustomizations");
    let E = inspect?.workspaceValue ?? inspect?.workspaceFolderValue;
    if (!E) {
      d?.appendLine(
        "[Semantic Theme] Nothing to reset: no theme customizations in workspace settings.",
      );
      return;
    }
    let C = {
      ...(E.rules ?? {}),
    };
    let M = 0;
    for (let THEME_TOKEN_TYPESItem of THEME_TOKEN_TYPES) {
      if (THEME_TOKEN_TYPESItem in C) {
        delete C[THEME_TOKEN_TYPESItem];
        M++;
      }
    }
    if (SemanticThemeManager.isLegacyOwnedParameterRule(C.parameter)) {
      delete C.parameter;
      M++;
    }
    let v = {
      ...E,
    };
    SemanticThemeManager.removeOwnedVerilogScope(v);
    if (Object.keys(C).length > 0) {
      v.rules = C;
    } else {
      delete v.rules;
    }
    await configuration.update(
      "semanticTokenColorCustomizations",
      Object.keys(v).length > 0 ? v : undefined,
      vscode.ConfigurationTarget.Workspace,
    );
    d?.appendLine(`[Semantic Theme] Reset complete: removed ${M} managed token colour rule(s).`);
  }
  static isLegacyOwnedParameterRule(d) {
    return !d || typeof d != "object"
      ? false
      : Object.values(SEMANTIC_THEMES).some((m) => {
          let verilogParameter = m.rules.verilogParameter;
          return (
            verilogParameter !== undefined && JSON.stringify(verilogParameter) === JSON.stringify(d)
          );
        });
  }
  static removeOwnedVerilogScope(d) {
    let m = d["[verilog]"];
    if (!m || typeof m != "object") {
      return;
    }
    let k = Object.keys(m.rules ?? {});
    if (k.length > 0 && k.every((C) => THEME_TOKEN_TYPES.includes(C) || C === "parameter")) {
      delete d["[verilog]"];
    }
  }
  static async selectThemeInteractive(d) {
    let value = vscode.workspace.getConfiguration("theryx").get("semanticTheme", "theryx-dark");
    let k = Object.values(SEMANTIC_THEMES).map((C) => ({
      label: C.label,
      description: C.id === value ? "(Active)" : "",
      detail: C.description,
      themeId: C.id,
    }));
    let showQuickPick = await vscode.window.showQuickPick(k, {
      placeHolder: "Select semantic highlighting theme for Verilog hardware (IEEE 1364):",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (showQuickPick) {
      await SemanticThemeManager.applyTheme(showQuickPick.themeId, d);
      vscode.window.showInformationMessage(
        `Hardware theme '${showQuickPick.label}' applied to this workspace. Your personal settings were not modified.`,
      );
    }
  }
}
