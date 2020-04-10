import * as O from "fp-ts/lib/Option";
import * as gen from "io-ts-codegen";
import { ApiBody, ApiParameter, ApiResponse } from "../parser/parserState";

export function getTypeName(type: gen.TypeReference): string {
  return gen.printStatic(type);
}

export function generateFunctionArgs(
  params: ApiParameter[],
  body: O.Option<ApiBody>
): string {
  const args = params.map(p => `${p.name}: ${getTypeName(p.type)}`);
  if (O.isSome(body)) {
    args.push(`body: ${getTypeName(body.value.type)}`);
  }
  return args.join(", ");
}

export function createUrlTemplate(path: string): string {
  return path.replace("{", "${");
}

export function getResponsesType(responses: ApiResponse[]): string {
  const success = responses.find(
    r => r.code === "200" && r.mediaType === "application/json"
  );
  return success ? getTypeName(success.type) : "unknown";
}