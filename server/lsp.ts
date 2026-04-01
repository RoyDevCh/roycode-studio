import path from 'node:path'
import ts from 'typescript'
import { readWorkspaceFile, resolveWorkspacePath } from './filesystem.js'
import type { AccessMode } from './types.js'

export type LspLocation = {
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

export type LspDiagnostic = {
  file: string
  line: number
  column: number
  category: string
  code: number
  message: string
}

export type LspDocumentSymbol = {
  name: string
  kind: string
  line: number
  column: number
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])

function ensureSupportedFile(filePath: string): void {
  const extension = path.extname(filePath).toLowerCase()
  if (!TS_EXTENSIONS.has(extension)) {
    throw new Error('Current RoyCode LSP subset supports TypeScript and JavaScript files only')
  }
}

function buildLanguageService(workspaceRoot: string, entryFile: string): {
  service: ts.LanguageService
  absolutePath: string
} {
  const absolutePath = path.resolve(workspaceRoot, entryFile)
  ensureSupportedFile(absolutePath)

  const configPath =
    ts.findConfigFile(workspaceRoot, ts.sys.fileExists, 'tsconfig.json') ??
    ts.findConfigFile(workspaceRoot, ts.sys.fileExists, 'jsconfig.json')

  let fileNames = [absolutePath]
  let options: ts.CompilerOptions = {
    allowJs: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
  }

  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    if (configFile.error) {
      throw new Error(
        ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
      )
    }
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
    )
    fileNames = parsed.fileNames.includes(absolutePath)
      ? parsed.fileNames
      : [...parsed.fileNames, absolutePath]
    options = parsed.options
  }

  const versions = new Map<string, string>()
  for (const fileName of fileNames) {
    versions.set(fileName, '0')
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => fileNames,
    getScriptVersion: fileName => versions.get(fileName) ?? '0',
    getScriptSnapshot: fileName => {
      const content = ts.sys.readFile(fileName)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => workspaceRoot,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  }

  return {
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    absolutePath,
  }
}

function toLineColumn(
  sourceFile: ts.SourceFile,
  start: number,
  end?: number,
): Pick<LspLocation, 'line' | 'column' | 'endLine' | 'endColumn'> {
  const startPos = sourceFile.getLineAndCharacterOfPosition(start)
  const result: Pick<LspLocation, 'line' | 'column' | 'endLine' | 'endColumn'> = {
    line: startPos.line + 1,
    column: startPos.character + 1,
  }
  if (typeof end === 'number') {
    const endPos = sourceFile.getLineAndCharacterOfPosition(end)
    result.endLine = endPos.line + 1
    result.endColumn = endPos.character + 1
  }
  return result
}

function resolveOffset(
  sourceFile: ts.SourceFile,
  line: number,
  column: number,
): number {
  return sourceFile.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, column - 1))
}

export async function getLspDiagnostics(
  workspaceRoot: string,
  filePath: string,
  accessMode: AccessMode,
): Promise<LspDiagnostic[]> {
  const relativePath = resolveWorkspacePath(workspaceRoot, filePath, '.', accessMode)
  const relativeFromRoot = path.relative(workspaceRoot, relativePath)
  const { service, absolutePath } = buildLanguageService(workspaceRoot, relativeFromRoot)
  const program = service.getProgram()
  if (!program) {
    return []
  }
  const sourceFile = program.getSourceFile(absolutePath)
  if (!sourceFile) {
    throw new Error('Source file not loaded in local LSP service')
  }

  return service.getSemanticDiagnostics(absolutePath).map(diag => {
    const pos = toLineColumn(sourceFile, diag.start ?? 0, (diag.start ?? 0) + (diag.length ?? 0))
    return {
      file: absolutePath,
      line: pos.line,
      column: pos.column,
      category: ts.DiagnosticCategory[diag.category].toLowerCase(),
      code: diag.code,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    }
  })
}

export async function getLspDefinitions(args: {
  workspaceRoot: string
  filePath: string
  line: number
  column: number
  accessMode: AccessMode
}): Promise<LspLocation[]> {
  const relativePath = path.relative(
    args.workspaceRoot,
    resolveWorkspacePath(args.workspaceRoot, args.filePath, '.', args.accessMode),
  )
  const { service, absolutePath } = buildLanguageService(args.workspaceRoot, relativePath)
  const program = service.getProgram()
  const sourceFile = program?.getSourceFile(absolutePath)
  if (!program || !sourceFile) {
    return []
  }
  const offset = resolveOffset(sourceFile, args.line, args.column)
  const defs = service.getDefinitionAtPosition(absolutePath, offset) ?? []
  return defs
    .map(def => {
      const file = program.getSourceFile(def.fileName)
      if (!file) {
        return null
      }
      return {
        file: def.fileName,
        ...toLineColumn(file, def.textSpan.start, def.textSpan.start + def.textSpan.length),
      }
    })
    .filter((item): item is LspLocation => Boolean(item))
}

export async function getLspReferences(args: {
  workspaceRoot: string
  filePath: string
  line: number
  column: number
  accessMode: AccessMode
}): Promise<LspLocation[]> {
  const relativePath = path.relative(
    args.workspaceRoot,
    resolveWorkspacePath(args.workspaceRoot, args.filePath, '.', args.accessMode),
  )
  const { service, absolutePath } = buildLanguageService(args.workspaceRoot, relativePath)
  const program = service.getProgram()
  const sourceFile = program?.getSourceFile(absolutePath)
  if (!program || !sourceFile) {
    return []
  }
  const offset = resolveOffset(sourceFile, args.line, args.column)
  const refs = service.getReferencesAtPosition(absolutePath, offset) ?? []
  return refs
    .map(ref => {
      const file = program.getSourceFile(ref.fileName)
      if (!file) {
        return null
      }
      return {
        file: ref.fileName,
        ...toLineColumn(file, ref.textSpan.start, ref.textSpan.start + ref.textSpan.length),
      }
    })
    .filter((item): item is LspLocation => Boolean(item))
}

export async function getLspHover(args: {
  workspaceRoot: string
  filePath: string
  line: number
  column: number
  accessMode: AccessMode
}): Promise<{
  display: string[]
  documentation: string
}> {
  const relativePath = path.relative(
    args.workspaceRoot,
    resolveWorkspacePath(args.workspaceRoot, args.filePath, '.', args.accessMode),
  )
  const { service, absolutePath } = buildLanguageService(args.workspaceRoot, relativePath)
  const program = service.getProgram()
  const sourceFile = program?.getSourceFile(absolutePath)
  if (!program || !sourceFile) {
    return { display: [], documentation: '' }
  }
  const offset = resolveOffset(sourceFile, args.line, args.column)
  const quickInfo = service.getQuickInfoAtPosition(absolutePath, offset)
  if (!quickInfo) {
    return { display: [], documentation: '' }
  }
  return {
    display: ts.displayPartsToString(quickInfo.displayParts).split('\n').filter(Boolean),
    documentation: ts.displayPartsToString(quickInfo.documentation),
  }
}

export async function getLspDocumentSymbols(
  workspaceRoot: string,
  filePath: string,
  accessMode: AccessMode,
): Promise<LspDocumentSymbol[]> {
  const relativePath = path.relative(
    workspaceRoot,
    resolveWorkspacePath(workspaceRoot, filePath, '.', accessMode),
  )
  const { service, absolutePath } = buildLanguageService(workspaceRoot, relativePath)
  const program = service.getProgram()
  const sourceFile = program?.getSourceFile(absolutePath)
  if (!program || !sourceFile) {
    return []
  }
  const navTree = service.getNavigationTree(absolutePath)
  const symbols: LspDocumentSymbol[] = []
  const resolvedSourceFile = sourceFile

  function visit(item: ts.NavigationTree): void {
    for (const span of item.spans ?? []) {
      const pos = toLineColumn(resolvedSourceFile, span.start)
      symbols.push({
        name: item.text,
        kind: item.kind,
        line: pos.line,
        column: pos.column,
      })
    }
    for (const child of item.childItems ?? []) {
      visit(child)
    }
  }

  for (const child of navTree.childItems ?? []) {
    visit(child)
  }

  return symbols
}

export async function readNotebookFilePreview(
  workspaceRoot: string,
  filePath: string,
  accessMode: AccessMode,
): Promise<string> {
  return readWorkspaceFile(workspaceRoot, filePath, accessMode)
}
