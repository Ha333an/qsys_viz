# Quartus Qsys Extension for Vscode with Draw.io Export

Quartus Qsys Viz is a Visual Studio Code extension that visualizes QSYS block‑design systems from Intel Quartus for FPGA development, making it easier and faster to inspect, navigate, and understand complex hardware designs directly within the VS Code editor.

> **Disclaimer:**
> This extension is an independent, community-developed tool and is not an official product of Intel or the Quartus Prime software suite.
> It is provided “as-is” without any warranties, and Intel Corporation is not responsible for its functionality, support, or maintenance.

Follow these steps to generate your .vsix file:

1. Extract this zip file.
2. Open the folder in a terminal.
3. Run `npm install` to install the build tools.
4. Run `npm run compile` to bundle the React application and Extension logic.
5. Run `npm start` to test the app on a browser.
6. Run `npx vsce package` or `npm run package` to generate the final **.vsix** file.

You can then install the .vsix in VS Code via "Extensions: Install from VSIX...".

## What's New (v1.0.8)

- Compact, flatter UI for better canvas visibility.
- Left settings panel now auto-hides after startup and can be revealed by hovering the left edge.
- Right inspector panel is compact and auto-dismisses after a short timeout.
- Address Map moved to a dedicated floating panel for wider table viewing.
- Address Map CSV export button added.
- Improved address extraction from `.qsys` connections (`base` / inferred `end` / range).
- Added `F` keyboard shortcut to fit and center the diagram.

## Usage

- Open any `.qsys` file in VS Code to launch the custom editor view.
- Use the compact header controls to import a file (browser mode) or export the current layout to Draw.io.
- Click a component or net to open the right-side inspector panel.
- Drag components to manually reposition blocks.
- Open Address Map with the bottom-left `Address Map` button to inspect master/slave ranges.
- Export table data with `Export CSV` inside the Address Map panel.

## Keyboard shortcuts

- Press `F` to fit and center the drawing to the current viewport.

> Note: The `F` shortcut is ignored while typing in inputs or other editable fields.