import * as path from 'path';
import * as vscodeTest from 'vscode-test';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    await vscodeTest.runTests({ extensionDevelopmentPath, extensionTestsPath: path.resolve(__dirname, './suite/index') });
  } catch (err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}
main();