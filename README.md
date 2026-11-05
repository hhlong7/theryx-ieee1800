# Theryx Verilog

A VS Code extension for Verilog (IEEE 1364) and SystemVerilog (IEEE 1800). It gives you RTL schematics, STARC/RMM lint, error checking and code navigation. It doesn't replace your simulator or synthesis tools.

This is an alpha version, so expect some bugs.

This fork adds SystemVerilog to [Theryx by Luigi C. Filho](https://github.com/luigicfilho/theryx). Distributed under the [MIT](LICENSE) license.

## Install

You need VS Code 1.85 or newer on macOS or Windows. The steps are the same on both, apart from the shortcuts shown.

1. Download [theryx-verilog-0.2.0-alpha.vsix](https://github.com/hhlong7/theryx-ieee1800/raw/systemverilog-support/theryx-verilog-0.2.0-alpha.vsix).
2. In VS Code, open the Extensions view: `Cmd+Shift+X` on Mac, `Ctrl+Shift+X` on Windows.
3. Click the `...` menu at the top of the Extensions view and choose **Install from VSIX...**.
4. Select the downloaded file.
5. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows) and run **Developer: Reload Window**.

To update, repeat these steps with the newer file.

### Install from the terminal

**Mac** (works even if `code` isn't on your PATH):

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension ~/Downloads/theryx-verilog-0.2.0-alpha.vsix --force
```

**Windows** (PowerShell):

```powershell
code --install-extension "$HOME\Downloads\theryx-verilog-0.2.0-alpha.vsix" --force
```

If Windows says `code` isn't recognized, use the full path:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --install-extension "$HOME\Downloads\theryx-verilog-0.2.0-alpha.vsix" --force
```

Then reload the window as in step 5.

## Use

1. Open your project **folder** in VS Code (**File > Open Folder**), so the extension can find modules and packages in your other files.
2. Open a design file. The extension picks the language from the file extension:
   - `.v` and `.vh` are Verilog (IEEE 1364)
   - `.sv` and `.svh` are SystemVerilog (IEEE 1800)
3. Errors and lint warnings appear as you type, underlined in the code and listed in the Problems panel.

### View a schematic

Click the links shown above your code:

| Link | Where it appears | What it does |
| --- | --- | --- |
| **View Module Schematic** | Above a `module` | Draws the whole module |
| **Inspect Subcircuit** | Above an `assign` or `always` | Draws only that logic |
| **Inspect Submodule** | Above an instance | Opens that submodule's schematic |
| **Open Source** | Above an instance | Opens the submodule's file |

In the schematic:

- Click a wire to highlight its path and jump to that signal in the code.
- Double-click a submodule to go inside it, and use the breadcrumbs in the toolbar to go back.
- Use the toolbar to zoom, fit to screen or export an SVG.

### Shortcuts

| Action | Mac | Windows |
| --- | --- | --- |
| Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Problems panel | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Quick fix for an error or lint warning | `Cmd+.` | `Ctrl+.` |
| Go to definition | `F12` or `Cmd+Click` | `F12` or `Ctrl+Click` |
| Autocomplete | `Ctrl+Space` | `Ctrl+Space` |
| Show details | Hover over a name | Hover over a name |

On a Mac keyboard, you may need to press `Fn+F12`.

To connect a module's ports automatically, type `(` after the instance name and pick an option from the autocomplete list.

### Commands and settings

These commands are in the Command Palette:

- **Theryx: Create Rules File (.theryx-rules.json)** creates a file where you can turn lint rules on or off and change their severity.
- **Theryx: Select Hardware Color Theme (Semantic Highlighting)** picks how clocks, resets, registers and wires are colored.
- **Theryx: Reset Semantic Theme (Remove Theme Colors)** removes those colors.

If your modules live outside the open folder, add their directories to `theryx.moduleSearchPaths` in your settings.

Testbenches are detected automatically and skip lint and error underlines. To check them too, turn off `theryx.lint.ignoreTestbenches`.

## What it supports

### Fully supported

Parsed, linted, drawn in the schematic, and available to hover and go to definition:

- **Data types:** `logic`, `bit`, `int` and the other built-in types, `typedef`, `enum`, packed `struct` and `union`, packed and unpacked arrays
- **Packages:** `import`, `export` and `pkg::NAME`, including packages in other files in the workspace
- **Interfaces:** interface ports and modports, flattened into their individual signals
- **Procedural blocks:** `always_ff`, `always_comb`, `always_latch`
- **Connections:** `.*` and `.name`
- **Parameters and generate:** type parameters, and generate `if`, `case` and `for`
- **Expressions and statements:** casts, `inside`, `'{...}` patterns, `'0` and `'1`, `++` and `+=`, `unique` and `priority`, `foreach`, functions and tasks

### Accepted, but not drawn

These don't cause false errors, but they don't appear in the schematic.

Mistakes inside these aren't reported:

- Classes (shown in the outline) and constraints
- Assertions, properties and sequences
- `randsequence`, covergroups, `clocking` blocks and `checker` blocks

Their contents are still checked:

- `fork`/`join`
- Dynamic arrays and queues

UDPs are also accepted and treated as black boxes.

### Preprocessor

- `` `define `` with arguments and defaults, and `` `undef ``
- `` `include ``
- `` `ifdef ``, `` `ifndef ``, `` `elsif ``, `` `else ``
- `` `default_nettype `` and `` `begin_keywords ``

### Errors found in `.sv` files

- **Names:** unknown types, struct or interface members, and package items
- **Instances:** wrong ports or parameters, and `.*` or `.name` with no matching signal
- **Calls:** undeclared tasks and functions, wrong arguments, and calling a task from a function
- **Declarations:** duplicates, and values that must be constant but aren't
- **Drivers:** a variable driven from more than one place, and `always_ff` or `always_comb` rule violations
- **Other mistakes:** bad `enum` values, mismatched end labels, `break` or `return` in the wrong place, bad number literals, and preprocessor mistakes

### Lint rules

These apply to `.v` and `.sv` files. Each can be configured in `.theryx-rules.json`.

| Rule | Checks |
| --- | --- |
| STARC-1.1.1 | Clock and reset names |
| STARC-2.1.1 | Blocking and non-blocking assignments mixed in one block |
| STARC-2.1.2 | Non-blocking in sequential logic, blocking in combinational logic |
| STARC-2.3.1 | `default` in every `case` |
| STARC-Latch | Accidental latches |
| RMM-2.2 | Named port connections |

### Not supported yet

- `.f` filelists, `+incdir` and `+define`, so macros defined outside a file and its includes show a warning
- Checking inside classes, constraints and assertions
- Assignment width errors
- Drawing each generate loop iteration or instance array element separately, since only one copy is shown
- Parameter overrides changing widths or generate branches, since only default values are used
- Hover on struct members, and `.` or `::` completion
- UVM isn't bundled, so `import uvm_pkg::*` shows a warning unless UVM is in your workspace
