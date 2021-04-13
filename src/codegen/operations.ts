import { pipe } from "fp-ts/function";
import * as A from "fp-ts/Array";
import * as O from "fp-ts/Option";
import * as RTE from "fp-ts/ReaderTaskEither";
import * as R from "fp-ts/Record";
import * as gen from "io-ts-codegen";
import { capitalize } from "../common/utils";
import { BodyItemOrRef } from "../parser/body";
import { ParsedOperation } from "../parser/operation";
import {
  generateSchemaIfDeclaration,
  getParsedItem,
  isParsedItem,
  OPERATIONS_PATH,
  PARAMETERS_PATH,
  RUNTIME_PACKAGE,
  SCHEMAS_PATH,
  writeGeneratedFile,
  getItemOrRefPrefix,
  REQUEST_BODIES_PATH,
  RESPONSES_PATH,
} from "./common";
import { CodegenContext, CodegenRTE } from "./context";
import { generateParameterDefinition } from "./parameter";
import { ParameterItemOrRef } from "../parser/parameter";
import { generateOperationResponses } from "./response";
import { ResponseItemOrRef } from "../parser/response";
import { generateOperationBody, generateOperationBodySchema } from "./body";

export function generateOperations(): CodegenRTE<void> {
  return pipe(
    RTE.asks((context: CodegenContext) => context.parserOutput.operations),
    RTE.chain((operations) =>
      R.traverseWithIndex(RTE.readerTaskEitherSeq)(generateOperation)(
        operations
      )
    ),
    RTE.map(() => void 0)
  );
}

interface GeneratedOperationParameters {
  schemas: string;
  definition: string;
  requestMap: string;
}

interface GeneratedBody {
  bodyType: string;
  requestBody?: string;
  requestBodyName: string;
}

interface GeneratedItems {
  parameters?: GeneratedOperationParameters;
  body?: GeneratedBody;
  successfulResponse: string;
  returnType: string;
}

function generateOperation(
  operationId: string,
  operation: ParsedOperation
): CodegenRTE<void> {
  return pipe(
    generateItems(operationId, operation),
    RTE.chain((items) => generateFileContent(operationId, operation, items)),
    RTE.chain((content) =>
      writeGeneratedFile(OPERATIONS_PATH, `${operationId}.ts`, content)
    )
  );
}

function generateItems(
  operationId: string,
  operation: ParsedOperation
): CodegenRTE<GeneratedItems> {
  return pipe(
    RTE.Do,
    RTE.bind("parameters", () =>
      generateOperationParameters(operationId, operation.parameters)
    ),
    RTE.bind("body", () => generateBody(operation.body)),
    RTE.bind("successfulResponse", () =>
      generateOperationResponses(operation.responses)
    ),
    RTE.bind("returnType", () => getReturnType(operation.responses))
  );
}

function generateFileContent(
  operationId: string,
  operation: ParsedOperation,
  items: GeneratedItems
): CodegenRTE<string> {
  const content = `import * as t from "io-ts";
  import * as schemas from "../${SCHEMAS_PATH}";
  import * as parameters from "../${PARAMETERS_PATH}";
  import * as responses from "../${RESPONSES_PATH}";
  import * as requestBodies from "../${REQUEST_BODIES_PATH}";
  import { Operation, HttpRequestAdapter, ApiError, ApiResponse, request } from "${RUNTIME_PACKAGE}";
  import { TaskEither } from "fp-ts/TaskEither";

  ${
    items.parameters
      ? `${items.parameters.schemas}
  ${items.parameters.requestMap}`
      : ""
  }

  ${items.body?.requestBody ?? ""}

  ${generateRequestDefinition(operationId, operation, items)}

  ${generateRequest(operationId, items)}
  `;

  return RTE.right(content);
}

function generateOperationParameters(
  operationId: string,
  parameters: ParameterItemOrRef[]
): CodegenRTE<GeneratedOperationParameters | undefined> {
  if (parameters.length === 0) {
    return RTE.right(undefined);
  }

  return pipe(
    RTE.Do,
    RTE.bind("schemas", () => generateOperationParametersSchemas(parameters)),
    RTE.bind("definition", () =>
      generateOperationParametersDefinition(parameters)
    ),
    RTE.bind("requestMap", () =>
      generateRequestParametersMap(operationId, parameters)
    )
  );
}

function generateOperationParametersSchemas(
  parameters: ParameterItemOrRef[]
): CodegenRTE<string> {
  const schemas = pipe(
    parameters,
    A.filter(isParsedItem),
    A.map((parameter) => generateSchemaIfDeclaration(parameter.item.type))
  );

  return RTE.right(schemas.join("\n"));
}

function generateOperationParametersDefinition(
  parameters: ParameterItemOrRef[]
): CodegenRTE<string> {
  return pipe(
    parameters,
    RTE.traverseSeqArray(generateOperationParameterDefinition),
    RTE.map((defs) => `[ ${defs.join(",")} ]`)
  );
}

function generateOperationParameterDefinition(
  parameter: ParameterItemOrRef
): CodegenRTE<string> {
  return pipe(
    getParsedItem(parameter),
    RTE.map((item) => {
      if (parameter._tag === "ComponentRef") {
        return `${parameter.componentType}.${item.name}`;
      } else {
        return generateParameterDefinition(item.item);
      }
    })
  );
}

function generateRequestParametersMap(
  operationId: string,
  parameters: ParameterItemOrRef[]
): CodegenRTE<string> {
  const mapName = requestParametersMapName(operationId);

  return pipe(
    parameters,
    RTE.traverseSeqArray(generateRequestParameter),
    RTE.map(
      (ps) => `export type ${mapName} = {
      ${ps.join("\n")}
  }`
    )
  );
}

function generateRequestParameter(
  itemOrRef: ParameterItemOrRef
): CodegenRTE<string> {
  return pipe(
    getParsedItem(itemOrRef),
    RTE.map((parameter) => {
      const staticType =
        parameter.item.type.kind === "TypeDeclaration"
          ? `${getItemOrRefPrefix(parameter)}${parameter.name}`
          : gen.printStatic(parameter.item.type);

      return `${parameter.name}: ${staticType} ${
        !parameter.item.required ? `| undefined` : ""
      };`;
    })
  );
}

function generateRequestDefinition(
  operationId: string,
  operation: ParsedOperation,
  generatedItems: GeneratedItems
): string {
  const { path, method } = operation;

  return `export const ${requestDefinitionName(operationId)}: Operation = {
      path: "${path}",
      method: "${method}",
      responses: ${generatedItems.successfulResponse},
      parameters: ${generatedItems.parameters?.definition ?? "[]"},
      requestDefaultHeaders: {},
      ${generatedItems.body ? `body: ${generatedItems.body.bodyType}` : ""}
  }`;
}

function generateBody(
  itemOrRef: O.Option<BodyItemOrRef>
): CodegenRTE<GeneratedBody | undefined> {
  if (O.isNone(itemOrRef)) {
    return RTE.right(undefined);
  }

  return pipe(
    getParsedItem(itemOrRef.value),
    RTE.map((body) => {
      const res: GeneratedBody = {
        bodyType: isParsedItem(itemOrRef.value)
          ? generateOperationBody(body)
          : `${getItemOrRefPrefix(itemOrRef.value)}${body.name}`,
        requestBody: isParsedItem(itemOrRef.value)
          ? generateOperationBodySchema(body.name, body.item)
          : undefined,
        requestBodyName: `${getItemOrRefPrefix(itemOrRef.value)}${
          body.name
        }Schema`,
      };

      return res;
    })
  );
}

function generateRequest(
  operationId: string,
  generatedItems: GeneratedItems
): string {
  const PARAM_ARG_NAME = "params";
  const BODY_ARG_NAME = "body";

  const args: string[] = [];

  if (generatedItems.parameters) {
    args.push(`${PARAM_ARG_NAME}: ${requestParametersMapName(operationId)}`);
  }

  if (generatedItems.body) {
    args.push(`${BODY_ARG_NAME}: ${generatedItems.body.requestBodyName}`);
  }

  return `export const ${operationId} = (requestAdapter: HttpRequestAdapter) => (${args.join(
    ", "
  )}): TaskEither<ApiError, ApiResponse<${generatedItems.returnType}>> =>
      request(${requestDefinitionName(operationId)}, ${
    generatedItems.parameters ? PARAM_ARG_NAME : "{}"
  }, ${generatedItems.body ? BODY_ARG_NAME : "undefined"}, requestAdapter);`;
}

function getReturnType(
  responses: Record<string, ResponseItemOrRef>
): CodegenRTE<string> {
  const successfulResponse = getSuccessfulResponse(responses);

  if (successfulResponse == null) {
    return RTE.right("void");
  }

  return pipe(
    getParsedItem(successfulResponse),
    RTE.map((response) => {
      if (response.item._tag === "ParsedEmptyResponse") {
        return "void";
      }

      if (response.item._tag === "ParsedFileResponse") {
        return "Blob";
      }

      const { type } = response.item;

      const staticType =
        type.kind === "TypeDeclaration"
          ? `${getItemOrRefPrefix(response)}${type.name}`
          : gen.printStatic(type);

      return staticType;
    })
  );
}

function getSuccessfulResponse(
  responses: Record<string, ResponseItemOrRef>
): ResponseItemOrRef | undefined {
  const successfulCode = Object.keys(responses).find((c) => c.startsWith("2"));

  return successfulCode ? responses[successfulCode] : undefined;
}

function requestParametersMapName(operationId: string): string {
  return `${capitalize(operationId, "pascal")}RequestParameters`;
}

function requestDefinitionName(operationId: string): string {
  return `${capitalize(operationId, "camel")}Operation`;
}
