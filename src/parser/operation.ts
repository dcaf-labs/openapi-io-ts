import { pipe } from "fp-ts/lib/pipeable";
import * as O from "fp-ts/Option";
import * as RTE from "fp-ts/ReaderTaskEither";
import * as R from "fp-ts/Record";
import { OpenAPIV3 } from "openapi-types";
import { parseBody, ParsedBody } from "./body";
import { inlineObject } from "./common";
import { modifyParserOutput, ParserContext, ParserRTE } from "./context";
import { ParsedParameter, parseParameter } from "./parameter";
import { ParsedResponse, parseResponse } from "./response";

type OperationMethod = "get" | "post" | "put" | "delete";

interface OperationResponses {
  success: ParsedResponse;
  errors: Record<string, ParsedResponse>;
}

export type ParsedOperation = {
  path: string;
  method: OperationMethod;
  parameters: ParsedParameter[];
  body: O.Option<ParsedBody>;
  responses: OperationResponses;
};

export function parseAllPaths(): ParserRTE<void> {
  return pipe(
    RTE.asks((context: ParserContext) => context.document.paths),
    RTE.chain((paths) => {
      const tasks = Object.entries(paths).map(([path, pathObject]) =>
        pathObject ? parsePath(path, pathObject) : RTE.right(undefined)
      );
      return RTE.sequenceSeqArray(tasks);
    }),
    RTE.map(() => {})
  );
}

function parsePath(
  path: string,
  pathObject: OpenAPIV3.PathItemObject
): ParserRTE<void> {
  const operations = {
    get: pathObject?.get,
    post: pathObject?.post,
    put: pathObject?.put,
    delete: pathObject?.delete,
  };

  const tasks = Object.entries(operations).map(([method, operation]) =>
    operation
      ? parseAndAddOperation(path, method as OperationMethod, operation)
      : RTE.right(undefined)
  );

  return pipe(
    RTE.sequenceSeqArray(tasks),
    RTE.map(() => {})
  );
}

function parseAndAddOperation(
  path: string,
  method: OperationMethod,
  operation: OpenAPIV3.OperationObject
): ParserRTE<void> {
  const { operationId, tags } = operation;

  if (operationId == null) {
    return RTE.left(new Error(`Missing operationId in path ${path}`));
  }

  return pipe(
    parseOperation(path, method, operation),
    RTE.chain((parsed) =>
      modifyParserOutput((draft) => {
        draft.operations[operationId] = parsed;
      })
    ),
    RTE.chain(() => parseOperationTags(operationId, tags))
  );
}

function parseOperation(
  path: string,
  method: OperationMethod,
  operation: OpenAPIV3.OperationObject
): ParserRTE<ParsedOperation> {
  return pipe(
    RTE.Do,
    RTE.bind("parameters", () =>
      parseOperationParameters(operation.parameters)
    ),
    RTE.bind("body", () => parseOperationBody(operation.requestBody)),
    RTE.bind("responses", () => parseOperationResponses(operation.responses)),
    RTE.map(({ parameters, body, responses }) => {
      const operation: ParsedOperation = {
        path,
        method,
        parameters,
        body,
        responses,
      };
      return operation;
    })
  );
}

function parseOperationTags(
  operationId: string,
  tags?: string[]
): ParserRTE<void> {
  if (tags == null) {
    return RTE.right(undefined);
  }

  const tasks = tags.map((tag) =>
    modifyParserOutput((draft) => {
      const currentTags = draft.tags[tag];
      draft.tags[tag] = currentTags
        ? currentTags.concat(operationId)
        : [operationId];
    })
  );

  return pipe(
    tasks,
    RTE.sequenceSeqArray,
    RTE.map(() => {})
  );
}

function parseOperationParameters(
  params?: Array<OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject>
): ParserRTE<ParsedParameter[]> {
  if (params == null) {
    return RTE.right([]);
  }

  const tasks = pipe(
    params.map((p) => parseParameter(p)),
    RTE.sequenceArray
  );

  return pipe(
    tasks,
    RTE.map((res) => res as ParsedParameter[])
  );
}

function parseOperationBody(
  requestBody?: OpenAPIV3.ReferenceObject | OpenAPIV3.RequestBodyObject
): ParserRTE<O.Option<ParsedBody>> {
  if (requestBody == null) {
    return RTE.right(O.none);
  }

  return pipe(parseBody("Body", requestBody), RTE.map(O.some));
}

function parseOperationResponses(
  responses?: OpenAPIV3.ResponsesObject
): ParserRTE<OperationResponses> {
  if (responses == null) {
    return RTE.right({
      success: inlineObject({ _tag: "TextResponse" }),
      errors: {},
    });
  }

  const { left: errorResponses, right: successfulResponses } = pipe(
    responses,
    R.partitionWithIndex((code) => +code >= 200 && +code < 300)
  );

  return pipe(
    parseSuccessfulResponses(successfulResponses),
    RTE.bindTo("success"),
    RTE.bind("errors", () => parseErrorResponses(errorResponses)),
    RTE.map(({ success, errors }) => ({
      success,
      errors,
    }))
  );
}

function parseSuccessfulResponses(
  responses: Record<
    string,
    OpenAPIV3.ReferenceObject | OpenAPIV3.ResponseObject
  >
): ParserRTE<ParsedResponse> {
  const values = Object.values(responses);

  if (values.length === 0) {
    return RTE.right(inlineObject({ _tag: "TextResponse" }));
  }

  return parseResponse("SuccessfulResponse", values[0]);
}

function parseErrorResponses(
  responses: Record<
    string,
    OpenAPIV3.ReferenceObject | OpenAPIV3.ResponseObject
  >
): ParserRTE<OperationResponses["errors"]> {
  return pipe(
    responses,
    R.mapWithIndex((code, response) =>
      parseResponse(`Response${code}`, response)
    ),
    R.sequence(RTE.readerTaskEitherSeq)
  );
}