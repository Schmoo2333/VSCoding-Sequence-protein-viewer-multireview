"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = void 0;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const node_fetch_1 = require("node-fetch");
const path = require("node:path");
const vscode = require("vscode");
const ProteinViewerPanel_1 = require("./panels/ProteinViewerPanel");
const SUPPORTED_STRUCTURE_EXTENSIONS = [
    '.pdb',
    '.pdb.gz',
    '.pdbqt',
    '.mmcif',
    '.mmcif.gz',
    '.mcif',
    '.mcif.gz',
    '.cif',
    '.cif.gz',
    '.gro',
    '.xyz',
    '.mol',
    '.mol2',
    '.sdf',
    '.ent'
];
async function activate(context) {
    const helloCommand = vscode.commands.registerCommand("protein-viewer-multireview.start", () => {
        showInputBox().then((accession) => {
            console.log(accession);
            ProteinViewerPanel_1.ProteinViewerPanel.render(context.extensionUri, accession);
        });
    });
    const activateFromFiles = vscode.commands.registerCommand("protein-viewer-multireview.activateFromFiles", async (fileUri, selectedFiles) => {
        const resolvedSelection = await resolveStructureSelection(fileUri, selectedFiles);
        if (resolvedSelection.files.length === 0) {
            vscode.window.showWarningMessage("No supported protein structure files were found.");
            return;
        }
        ProteinViewerPanel_1.ProteinViewerPanel.renderFromFiles(context.extensionUri, resolvedSelection.files, resolvedSelection.startIndex);
    });
    const activateFromFolder = vscode.commands.registerCommand("protein-viewer-multireview.activateFromFolder", async (folderUri) => {
        const files = await getStructureFilesInFolder(folderUri);
        if (files.length === 0) {
            vscode.window.showWarningMessage("No supported protein structure files were found in the selected folder.");
            return;
        }
        ProteinViewerPanel_1.ProteinViewerPanel.renderFromFiles(context.extensionUri, files, 0);
    });
    const ESMFold = vscode.commands.registerCommand("protein-viewer-multireview.ESMFold", () => {
        showSequenceInputBox().then((sequence) => {
            getfold(sequence).then((pdb) => {
                writeFoldToFile(pdb).then(async (file_uri) => {
                    console.log(file_uri);
                    ProteinViewerPanel_1.ProteinViewerPanel.renderFromFiles(context.extensionUri, [vscode.Uri.file(file_uri)]);
                });
            });
        });
    });
    //context.subscriptions.push(...[helloCommand, activateFromFile]);
    context.subscriptions.push(helloCommand);
    context.subscriptions.push(activateFromFiles);
    context.subscriptions.push(activateFromFolder);
    context.subscriptions.push(ESMFold);
}
exports.activate = activate;
// this method is called when your extension is deactivated
// export function deactivate() {}
async function showInputBox() {
    const accession = await vscode.window.showInputBox({
        value: '',
        placeHolder: 'Enter a PDB or AlphaFoldDB (UniProt) accession',
    });
    return accession;
}
async function showSequenceInputBox() {
    const sequence = await vscode.window.showInputBox({
        value: '',
        placeHolder: 'Enter a protein sequence',
    });
    return sequence;
}
async function writeFoldToFile(file_contents) {
    const time = new Date().getTime();
    const fname = "/esmfold_" + time.toString() + ".pdb";
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error("A workspace folder is required to save the ESMFold output.");
    }
    const setting = vscode.Uri.parse("untitled:" + workspaceRoot + fname);
    await vscode.workspace.openTextDocument(setting).then((a) => {
        vscode.window.showTextDocument(a, 1, false).then(e => {
            e.edit(edit => {
                edit.insert(new vscode.Position(0, 0), file_contents);
                a.save();
            });
        });
    });
    console.log("wrote to test file.");
    console.log(setting);
    return setting.fsPath;
}
async function getfold(sequence) {
    const url = "https://api.esmatlas.com/foldSequence/v1/pdb/";
    console.log(sequence);
    const response = await (0, node_fetch_1.default)(url, {
        method: 'POST',
        body: sequence,
    });
    const body = await response.text();
    return body;
}
async function resolveStructureSelection(fileUri, selectedFiles) {
    const normalizedSelection = deduplicateFiles(selectedFiles ?? []).filter(isSupportedStructureFile);
    if (normalizedSelection.length > 1) {
        const files = sortFiles(normalizedSelection);
        const startIndex = Math.max(files.findIndex((candidate) => candidate.fsPath === fileUri.fsPath), 0);
        return { files, startIndex };
    }
    if (!isSupportedStructureFile(fileUri)) {
        return { files: [], startIndex: 0 };
    }
    const parentFolder = vscode.Uri.file(path.dirname(fileUri.fsPath));
    const files = await getStructureFilesInFolder(parentFolder);
    const startIndex = Math.max(files.findIndex((candidate) => candidate.fsPath === fileUri.fsPath), 0);
    return { files, startIndex };
}
async function getStructureFilesInFolder(folderUri) {
    const entries = await vscode.workspace.fs.readDirectory(folderUri);
    const files = entries
        .filter(([, fileType]) => fileType === vscode.FileType.File)
        .map(([name]) => vscode.Uri.joinPath(folderUri, name))
        .filter(isSupportedStructureFile);
    return sortFiles(files);
}
function isSupportedStructureFile(fileUri) {
    const fileName = path.basename(fileUri.fsPath).toLowerCase();
    return SUPPORTED_STRUCTURE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}
function sortFiles(files) {
    return [...files].sort((left, right) => path.basename(left.fsPath).localeCompare(path.basename(right.fsPath), undefined, {
        numeric: true,
        sensitivity: 'base'
    }));
}
function deduplicateFiles(files) {
    const uniqueFiles = new Map();
    for (const file of files) {
        uniqueFiles.set(file.fsPath, file);
    }
    return [...uniqueFiles.values()];
}
//# sourceMappingURL=extension.js.map