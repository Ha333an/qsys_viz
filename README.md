# Qsys Extension for Vscode with Draw.io Export

Qsys Viz is a Visual Studio Code extension that visualizes QSYS block‑design systems from Intel Quartus for FPGA development, making it easier and faster to inspect, navigate, and understand complex hardware designs directly within the VS Code editor.

Follow these steps to generate your .vsix file:

1. Extract this zip file.
2. Open the folder in a terminal.
3. Run `npm install` to install the build tools.
4. Run `npm run compile` to bundle the React application and Extension logic.
5. Run `npm start` to test the app on a browser.
6. Run `npx vsce package` or `npm run package` to generate the final **.vsix** file.

You can then install the .vsix in VS Code via "Extensions: Install from VSIX...".