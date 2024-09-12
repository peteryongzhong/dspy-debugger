/// <reference lib="dom" />
import Graph from "graphology";
import Sigma from "sigma";
import ForceSupervisor from "graphology-layout-force/worker";
import { EdgeArrowProgram } from "sigma/rendering";
import { escape } from "lodash";
interface vscode {
  postMessage(message: any): void;
}

declare let acquireVsCodeApi: () => vscode;
declare let trace_filepath : string;

let vscode: vscode;
try {
  vscode = acquireVsCodeApi();
} catch (error) {
  console.log(error);
}

// import DataTable from "datatables.net-dt";
// require("datatables.net-colresize-unofficial");

declare const $: any;
declare const DataTable: any;

interface SignatureEntry {
  __dspy_field_type?: "input" | "output";
  desc?: string;
  prefix?: string;
  title?: string;
  type?: string;
}

interface Signature {
  description?: string;
  properties: Record<string, SignatureEntry>;
  required?: [string];
  title?: string;
}

interface DebugTrace {
  class_name: string;
  object_id: number;
  frame_id: number;
  file : string;
  line : number;
  parent_frame_id?: number;
  parent_object_id?: number;
  parent_name?: string;
  args?: any[];
  kwargs?: Record<any, any>;
  time: number;
  result?: any;
}

interface DebugTraceVisualization {
  id: string;
  parent: string;
  text: string;
  object_id: number;
  parent_object_id?: number;
  parent_name?: string;
  args: any[];
  kwargs: Record<any, any>;
  time: number;
  result: any;
}

export interface PredictorDebugInfo {
  type: "PredictorDebugInfo";
  demos: [Record<string, Object>];
  signature: Signature;
  extended_signature?: Signature;
  unique_id: number;
}

export interface RetrieveDebugInfo {
  type: "RetrieveDebugInfo";
  k: number;
  unique_id: number;
}

export interface ModuleDebugInfo {
  unique_id: number;
  name: string;
  class_name: string;
  path: string;
  line_num: number;
  parameters: [[string, PredictorDebugInfo | RetrieveDebugInfo]];
  invoked_modules: [[string, number]];
}

declare let moduleInfo: ModuleDebugInfo[];
declare let lmInfo: string;
declare let rmInfo: string;

const graph = new Graph();

for (let module of moduleInfo) {
  let color: any = undefined;
  if (module.name === "current module") {
    color = "purple";
  } else {
    color = "green";
  }
  graph.addNode(module.unique_id, {
    size: 20,
    label: module.class_name,
    color: color,
    labelColor: "white",
  });

  for (let invokedModuleNameId of module.invoked_modules) {
    graph.addDirectedEdge(module.unique_id, invokedModuleNameId[1], {
      forceLabel: true,
      label: invokedModuleNameId[0],
      size: 10,
    });
  }
  for (let parameter of module.parameters) {
    let paramId = parameter[1].unique_id;
    let color: string;
    let label: string;
    if (parameter[1].type === "PredictorDebugInfo") {
      color = "DarkBlue";
      label = "Predictor";
    } else {
      color = "LightBlue";
      label = "Retriever";
    }
    graph.addNode(paramId, {
      size: 10,
      label: label,
      color: color,
      labelColor: "white",
    });
    graph.addDirectedEdge(module.unique_id, paramId, {
      forceLabel: true,
      label: parameter[0],
      size: 5,
    });
  }
}

graph.nodes().forEach((node, i) => {
  const angle = (i * 2 * Math.PI) / graph.order;
  graph.setNodeAttribute(node, "x", 100 * Math.cos(angle));
  graph.setNodeAttribute(node, "y", 100 * Math.sin(angle));
});

const renderer = new Sigma(
  graph,
  document.getElementById("graph") as HTMLDivElement,
  {
    allowInvalidContainer: true,
    renderEdgeLabels: true,
    labelColor: { attribute: "white", color: "white" },
    defaultEdgeType: "straight",
    edgeProgramClasses: {
      straight: EdgeArrowProgram,
    },
  }
);

const layout = new ForceSupervisor(graph);
layout.start();

type JQueryHTMLWithDataTable = JQuery<HTMLElement> & { jsonViewer: any };

let lmSettingPre: any = $("#lm-setting-pre");
lmSettingPre.jsonViewer(lmInfo);
let rmSettingPre: any = $("#rm-setting-pre");
rmSettingPre.jsonViewer(lmInfo);

$(".json-literal").css("color", "#00ffff");

let displayGeneric = () => {
  $("#generic-info").show();
  $("#retriver-info").hide();
  $("#predictor-info").hide();
  $("#module-info").hide();
  $("#trace-info").hide();
};

let displayModule = () => {
  $("#generic-info").hide();
  $("#retriver-info").hide();
  $("#predictor-info").hide();
  $("#module-info").show();
  $("#trace-info").hide();
};
let displayRetriver = () => {
  $("#generic-info").hide();
  $("#retriver-info").show();
  $("#predictor-info").hide();
  $("#module-info").hide();
  $("#trace-info").hide();
};
let displayPredictor = () => {
  $("#generic-info").hide();
  $("#retriver-info").hide();
  $("#predictor-info").show();
  $("#module-info").hide();
  $("#trace-info").hide();
};

let displayTraceInfo =()=>
{
  $("#generic-info").hide();
  $("#retriver-info").hide();
  $("#predictor-info").hide();
  $("#module-info").hide();
  $("#trace-info").show();
}

$("#back-btn").on("click", displayGeneric);

renderer.on("clickNode", ({ node }) => {
  let nodeID = node;
  let modules = moduleInfo.filter(
    (module) => module.unique_id.toString() === nodeID
  );
  let params = moduleInfo
    .map((module) =>
      module.parameters.filter(
        (param) => param[1].unique_id.toString() === nodeID
      )
    )
    .flat();
  if (modules.length === 1) {
    let module = modules[0];
    $("#module-class-span").text(module.class_name);
    $("#module-btn").off("click");
    $("#module-btn").on("click", () => {
      vscode.postMessage({
        command: "file-open",
        file: module.path,
        line: module.line_num,
      });
    });
    displayModule();
  }
  if (params.length === 1) {
    let param = params[0];
    if (param[1].type === "PredictorDebugInfo") {
      let predictor = param[1];
      let handlePredict = () => {
        let sig =
          $("#select-sig-id").find(":selected").val() === "signature"
            ? predictor.signature
            : predictor.extended_signature;
        let properties = sig?.properties || {};
        let sigProperties = Object.entries(properties).map(([k, v]) => v);
        if ($.fn.dataTable.isDataTable("#signature-table")) {
          $("#signature-table").DataTable().destroy();
        }
        if ($.fn.dataTable.isDataTable("#demos-table")) {
          $("#demos-table").DataTable().destroy();
        }
        $("#signature-instruction-textarea").text(sig.description);
        let signatureTable = $("#signature-table").DataTable({
          data: sigProperties,
          scrollX: true,
          scrollY: "10vh",
          scrollCollapse: true,
          columns: [
            { data: "__dspy_field_type", title: "DSPy Field Type" },
            { data: "desc", title: "Description" },
            { data: "prefix", title: "Prefix" },
            { data: "title", title: "Title" },
            { data: "type", title: "Type" },
          ],
        });

        let CUTOFF_LENGTH = 100;
        let unique_demo_cols = [
          ...new Set(predictor.demos.map((d) => Object.keys(d)).flat()),
        ];
        let ellipsisRender = (data, type, row) => {
          if (!data) {
            return ``;
          }
          let dataStr: string = data.toString();
          return dataStr.length > CUTOFF_LENGTH
            ? dataStr.substring(0, CUTOFF_LENGTH) + "\u2026"
            : dataStr;
        };
        let demo_cols = unique_demo_cols.map((k) => ({
          data: k,
          title: k,
          defaultContent: "",
          render: ellipsisRender,
        }));
        //@ts-ignore
        let demosTable = $("#demos-table").DataTable({
          data: predictor.demos,
          scrollY: "20vh",
          scrollCollapse: true,
          scrollX: true,
          autoWidth: true,
          pageLength: 3,
          columns: [
            {
              className: "expand-icon",
              orderable: false,
              defaultContent: `<i class ="fa fa-expand"></i>`,
            },
            ...demo_cols,
          ],
          colResize: {
            isEnabled: true,
          },
        });
        demosTable.on("click", "td.expand-icon", (e) => {
          let target_: any = e.target;
          let target: Element = target_;
          let tr = target.closest("tr");
          let row = demosTable.row(tr);

          if (row.child.isShown()) {
            // This row is already open - close it
            row.child.hide();
          } else {
            let data: Record<string, Object> = row.data();

            let stringEntries: [string, string][] = Object.entries(data).map(
              ([col, content]) => [col, content.toString()]
            );
            let exceededEntries: [string, string][] = stringEntries.filter(
              ([col, contentStr]) => {
                return contentStr.length > CUTOFF_LENGTH;
              }
            );
            let extraInfos = exceededEntries.map(
              ([col, content]) =>
                `<dt>${escape(col)}</dt><dd>${escape(content)}</dd>`
            );
            let finalstr = `<dl>${extraInfos.join("")}</dl>`;
            console.log(finalstr);
            row.child(finalstr).show();
          }
        });
        displayPredictor();
      };
      $("#select-sig-id").off("change");
      $("#select-sig-id").on("change", handlePredict);
      handlePredict();
    }
    if (param[1].type === "RetrieveDebugInfo") {
      displayRetriver();
      $("#retriver-k-span").text(param[1].k);
    }
  }
});

let handleVisualDisplay = () => {
  displayGeneric();
  if ($("#select-vis-div").find(":selected").val() === "static") {
    $("#graph").show();
    $("#dyn-trace").hide();
  } else {
    $("#graph").hide();
    $("#dyn-trace").show();
  }
};

$("#select-vis-id").on("change", handleVisualDisplay);

fetch(trace_filepath)
  .then((r) => r.json())
  .then((d) => {
    let data: DebugTrace[] = d;
    let uniqueIds = new Set(data.map((e) => e.frame_id));
    let parentForNotTraced: DebugTrace[] = data
      .filter((e) => e.parent_frame_id && !uniqueIds.has(e.parent_frame_id))
      .map((e) => {
        return {
          frame_id: e.parent_frame_id,
          object_id: e.parent_object_id,
          class_name: e.parent_name,
          time: e.time - 1
        };
      })
      .reduce((acc: DebugTrace[], current: DebugTrace) => {
        const existing = acc.find((item) => item.frame_id === current.frame_id);
        if (!existing || current.time < existing.time) {
          acc = acc.filter((item) => item.frame_id !== current.frame_id); // Remove any existing item with the same id
          acc.push(current); // Add the current item
        }
        return acc;
      }, []);
      
    let combinedData = data.concat(parentForNotTraced);
    let idToEntry: Map<number, DebugTrace> = new Map(
      combinedData.map((e) => [e.frame_id, e])
    );
    let idToChildren: Map<number, DebugTrace[]> = new Map();

    for (let trace of combinedData) {
      if(!trace.parent_frame_id)
      {
        continue;
      }
      if (!idToChildren.has(trace.parent_frame_id)) {
        idToChildren.set(trace.parent_frame_id, []);
      }
      idToChildren.get(trace.parent_frame_id).push(trace);
    }
    interface JSTreeData {
      id: string;
      text: string;
      icon?: string;
      children: JSTreeData[];
    }
    
    const traverse: (id: number) => JSTreeData = (id) => {
      let entry = idToEntry.get(id);
      let traceNodes = idToChildren.has(id)
        ? idToChildren.get(id).map((c) => traverse(c.frame_id))
        : [];
      return {
        id: id.toString(),
        text: entry.class_name,
        children: traceNodes,
        args : entry.args,
        kwargs : entry.kwargs,
        result : entry.result,
        file: entry.file,
        line: entry.line,
        icon: "hello"
      };
    };

    let orphans = combinedData.filter(e=>!e.parent_frame_id);
    let forest: JSTreeData[] = orphans.map(t => traverse(t.frame_id));

    console.log(forest);
   
    $("#dyn-trace")
      .jstree({
        core: {
          multiple: false,
          data: forest,
        },
      })
      .on("changed.jstree", (e, data) => {
        let trace = data.node.original;
        let args = trace.args ? trace.args : "\"Not Available\"";
        let kwargs = trace.kwargs ? trace.kwargs : "\"Not Available\"";
        let result = trace.result ? trace.result : "\"Not Available\"";
        $("#trace-args-pre").jsonViewer(args);
        $("#trace-kwargs-pre").jsonViewer(kwargs);
        $("#trace-result-pre").jsonViewer(result);
        if(trace.file)
        {
          $("#trace-module-btn").prop("disabled", false);
          $("trace-module-btn").off("click");
          $("#trace-module-btn").on("click", () => 
          vscode.postMessage({
            command: "file-open",
            file: trace.file,
            line: trace.line,
          }));          
        }
        else{
          $("#trace-module-btn").prop("disabled", true);
        }
        displayTraceInfo();
      });
  });
