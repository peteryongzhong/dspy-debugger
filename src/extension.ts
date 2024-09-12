// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as JSON5 from "json5";
import * as fs from "fs";

export class DSPyVarProvider implements vscode.TreeDataProvider<DSPyVariable> {
  constructor() {}

  private _onDidChangeTreeData: vscode.EventEmitter<
    DSPyVariable | DSPyVariable[] | undefined | null | void
  > = new vscode.EventEmitter<
    DSPyVariable | DSPyVariable[] | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    DSPyVariable | DSPyVariable[] | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DSPyVariable): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DSPyVariable): Thenable<DSPyVariable[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      return (async () => {
        const activeDebugSession = vscode.debug.activeDebugSession;
        if (!activeDebugSession) {
          return [];
        }
        const debugProxy = new DebugSessionProxy(activeDebugSession);
        let variablesPerScope: Variable[][];
        try {
          const scopes = await debugProxy.getScopes({
            frameId: CurrentThreadAndStack.frameId,
          });
          variablesPerScope = await Promise.all(
            scopes.map((scope) =>
              debugProxy.getVariables({
                variablesReference: scope.variablesReference,
              })
            )
          );
        } catch (e) {
          console.log(`Failure to obtain variable scope:`);
          console.log(e);
          return [];
        }

        const variables = variablesPerScope
          .flat()
          .filter((v) => Boolean(v.evaluateName))
          .filter((v) => !v.name.includes(" "))
          .filter(
            (value, index, self) =>
              index ===
              self.findIndex((t) => t.evaluateName === value.evaluateName)
          );
        if (
          variables.filter((v) => v.evaluateName?.includes("dspy")).length === 0
        ) {
          return [];
        }

        const variableQueries = variables.map(
          (v) => `isinstance(${v.evaluateName}, dspy.BaseModule)`
        );

        try {
          const evaluatedExpression = `str([${variableQueries.join(",")}])`;
          console.log(evaluatedExpression);
          const resultStr: string = (
            await debugProxy.evaluate({
              expression: evaluatedExpression,
              frameId: CurrentThreadAndStack.frameId,
              context: "repl",
            })
          ).result
            .replaceAll("F", "f")
            .replaceAll("T", "t");
          const isModule: Boolean[] = JSON5.parse(resultStr.slice(1, -1));
          const dspyVars = variables.filter((_, index) => isModule[index]);
          console.log(dspyVars);
          const treeItems = dspyVars.map(
            (dspyvar) =>
              new DSPyVariable(
                dspyvar.name,
                vscode.TreeItemCollapsibleState.None,
                dspyvar.evaluateName ?? ""
              )
          );
          return treeItems;
          // dspyVars.map( var => var.evaluateName);
        } catch (e) {
          console.log(`Failure to evaluate expression to check DSPyness:`);
          console.log(e);
          return [];
        }
        return [];
      })();
    }
  }
}

class DSPyVariable extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly varName: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `tooltip`;
    this.description = "description";
  }
}

export class DebugSessionProxy {
  constructor(public readonly session: vscode.DebugSession) {}

  public async getStackTrace(args: {
    threadId: number;
    startFrame?: number;
    levels?: number;
  }): Promise<StackTraceInfo> {
    try {
      const reply = (await this.session.customRequest("stackTrace", {
        threadId: args.threadId,
        levels: args.levels,
        startFrame: args.startFrame || 0,
      })) as { totalFrames?: number; stackFrames: StackFrame[] };
      return reply;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  public async getCompletions(args: {
    text: string;
    column: number;
    frameId: number | undefined;
  }): Promise<vscode.CompletionItem[]> {
    try {
      const reply = await this.session.customRequest("completions", {
        text: args.text,
        frameId: args.frameId,
        column: args.column,
      });
      if (!reply) {
        return [];
      }
      return reply.targets;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  public async getScopes(args: { frameId?: number }): Promise<Scope[]> {
    try {
      const reply = await this.session.customRequest("scopes", {
        frameId: args.frameId,
      });
      if (!reply) {
        return [];
      }
      return reply.scopes;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  public async getVariables(args: {
    variablesReference: number;
  }): Promise<Variable[]> {
    try {
      const reply = await this.session.customRequest("variables", {
        variablesReference: args.variablesReference,
      });
      if (!reply) {
        return [];
      }
      return reply.variables;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  /**
   * Evaluates the given expression.
   * If context is "watch", long results are usually shortened.
   */

  public async evaluate(args: {
    expression: string;
    frameId: number | undefined;
    context: "watch" | "repl" | "clipboard";
  }): Promise<{ result: string; variablesReference: number }> {
    const reply = await this.session.customRequest("evaluate", {
      expression: args.expression,
      frameId: args.frameId,
      context: args.context,
    });
    return {
      result: reply.result,
      variablesReference: reply.variablesReference,
    };
  }
}

export interface StackTraceInfo {
  totalFrames?: number;
  stackFrames: StackFrame[];
}

interface Scope {
  name: string;
  expensive: boolean;
  variablesReference: number;
}

interface Variable {
  name: string;
  value: string;
  variablesReference: number;
  type?: string;
  evaluateName?: string;
}

export interface StackFrame {
  id: number;
  name: string;
  source: { name: string; path: string };
}

class CurrentThreadAndStack {
  public static threadId?: number;
  public static frameId?: number;
  constructor() {}
}

export function activate(context: vscode.ExtensionContext) {
  let treeDataProvider = new DSPyVarProvider();
  let treeview = vscode.window.createTreeView("DSPyVars", {
    treeDataProvider: treeDataProvider,
  });
  let treeSelectionHandler = treeview.onDidChangeSelection(async (e) => {
    if (e.selection.length === 0) {
      return;
    }
    const activeDebugSession = vscode.debug.activeDebugSession;
    if (!activeDebugSession) {
      return;
    }
    const debugProxy = new DebugSessionProxy(activeDebugSession);
    let lmInfo = JSON.stringify(
      JSON5.parse(
        (
          await debugProxy.evaluate({
            expression: `dspy.settings.dump_info_for_field("lm")`,
            frameId: CurrentThreadAndStack.frameId,
            context: "clipboard",
          })
        ).result
      )
    );
    let rmInfo = JSON.stringify(
      JSON5.parse(
        (
          await debugProxy.evaluate({
            expression: `dspy.settings.dump_info_for_field("rm")`,
            frameId: CurrentThreadAndStack.frameId,
            context: "clipboard",
          })
        ).result
      )
    );
    let moduleInfo = JSON.stringify(
      JSON5.parse(
        (
          await debugProxy.evaluate({
            expression: `${e.selection[0].varName}.debug_info()`,
            frameId: CurrentThreadAndStack.frameId,
            context: "clipboard",
          })
        ).result
      )
    );
    const tempJSONTraceFile1 = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "trace1.json"
    );

    let raw_trace = (await debugProxy.evaluate({
              expression: `${e.selection[0].varName}.trace_info()`,
              frameId: CurrentThreadAndStack.frameId,
              context: "clipboard",
            })
          ).result;
    let first_char = raw_trace[0];
    raw_trace= raw_trace.replaceAll(`\\\\`, `\\`);
    if(first_char === `'`)
    {
      raw_trace = raw_trace.replaceAll(`\\'`, `'`);
    }
    else{
      raw_trace = raw_trace.replaceAll(`\\"`, `"`);
    }

    let traceInfo = JSON5.parse(raw_trace.slice(1, -1));

    const tempJSONTraceFile = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "trace.json"
    );

    fs.writeFileSync(tempJSONTraceFile.fsPath, JSON.stringify(traceInfo));

    const panel = vscode.window.createWebviewPanel(
      "dspy-debug-visualizer",
      "DSPy Debug Visualizer",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      }
    );

    const visualJSFilePath = panel.webview
      .asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "bundle.js")
      )
      .toString();

    const traceFilepath = panel.webview
    .asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "trace.json")
    )
    .toString();
    const htmlFilePath = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "main.html"
    );
    const htmlTemplate = fs.readFileSync(htmlFilePath.fsPath, "utf-8");
    const html: string = htmlTemplate
      .replace("<<moduleInfo>>", moduleInfo)
      .replace("<<rmInfo>>", rmInfo)
      .replace("<<lmInfo>>", lmInfo)
      .replace("<<visualJSFilePath>>", visualJSFilePath)
      .replace("<<JSONTraceFilePath>>",traceFilepath);
    console.log(html);

    // And set its HTML content
    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(
      async (message) => {
        let filePathStr: string = message.file;
        let lineNum: number = message.line;
        const filePath = vscode.Uri.file(filePathStr);
        let document = await vscode.workspace.openTextDocument(filePath);
        let editor = await vscode.window.showTextDocument(document);
        // Move the cursor to a specific line and column
        const line = 10; // specify the line number (0-based)
        const column = 0; // specify the column number (0-based)
        const position = new vscode.Position(lineNum, 0);
        const newSelection = new vscode.Selection(position, position);
        editor.selection = newSelection;
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      },
      undefined,
      context.subscriptions
    );
  });
  let stackItemChange = vscode.debug.onDidChangeActiveStackItem(async (_) => {
    console.log("Active Stack Item Changed");
    let stackitem = vscode.debug.activeStackItem;
    if (stackitem instanceof vscode.DebugThread) {
      CurrentThreadAndStack.threadId = stackitem.threadId;
    } else {
      CurrentThreadAndStack.frameId = stackitem?.frameId;
      CurrentThreadAndStack.threadId = stackitem?.threadId;
    }
    treeDataProvider.refresh();
  });
  context.subscriptions.push(
    stackItemChange,
    treeview,
    treeSelectionHandler
  );
  console.log('Congratulations, your extension "debugtest" is now active!');
}

export function deactivate() {}
