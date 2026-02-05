# Qsys Explorer Extension Export

Follow these steps to generate your .vsix file:

1. Extract this zip file.
2. Open the folder in a terminal.
3. Run `npm install` to install the build tools.
4. Run `npm run compile` to bundle the React application and Extension logic.
5. Run `npx vsce package` to generate the final **.vsix** file.

You can then install the .vsix in VS Code via "Extensions: Install from VSIX...".