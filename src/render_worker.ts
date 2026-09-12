// The generated wasm-bindgen package is created by `npm run build:wasm`.
// Every worker owns one WASM instance so requests remain independent.
// @ts-ignore generated module is absent until the WASM build runs.
import init, {
  colorchecker_points_normalized,
  evaluate_normalized,
  normalized_coordinates_from_acescg,
  normalized_coordinates_from_encoded,
  convert_normalized_profile,
  convert_normalized_background,
  render_rows_normalized,
} from "./wasm/pkg/modcam16_color_core.js";

type RenderMessage = {
  kind: "render";
  id: number;
  profile: number;
  j: number;
  width: number;
  height: number;
  yStart: number;
  yEnd: number;
  displayP3: boolean;
};
type EvaluateMessage = {
  kind: "evaluate";
  id: number;
  profile: number;
  j: number;
  saturationX: number;
  saturationY: number;
  background: number;
};
type ColorCheckerMessage = {
  kind: "colorchecker";
  id: number;
  profile: number;
};
type SetMessage = {
  kind: "set";
  id: number;
  profile: number;
  red: number;
  green: number;
  blue: number;
  acescg: boolean;
  sourceProfile?: number;
  linear?: boolean;
  sourceJ?: number;
  background?: number;
};
type CancelRenderMessage = { kind: "cancel-render"; id: number };
type Message =
  | RenderMessage
  | EvaluateMessage
  | ColorCheckerMessage
  | SetMessage
  | CancelRenderMessage;

let ready: Promise<void> | undefined;
let latestRenderId = -1;
let latestEvaluateId = -1;
let latestColorcheckerId = -1;
let latestSetId = -1;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function ensureReady(): Promise<void> {
  ready ??= init().then(() => undefined);
  return ready;
}

function reportError(message: Message) {
  workerScope.postMessage({
    kind: "worker-error",
    id: "id" in message ? message.id : -1,
    operation: message.kind,
    profile: "profile" in message ? message.profile : undefined,
  });
}

workerScope.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.kind === "cancel-render") {
    latestRenderId = Math.max(latestRenderId, message.id);
    return;
  }
  if (message.kind === "render")
    latestRenderId = Math.max(latestRenderId, message.id);
  if (message.kind === "evaluate")
    latestEvaluateId = Math.max(latestEvaluateId, message.id);
  if (message.kind === "colorchecker")
    latestColorcheckerId = Math.max(latestColorcheckerId, message.id);
  if (message.kind === "set") latestSetId = Math.max(latestSetId, message.id);

  void ensureReady()
    .then(() => {
      if (message.kind === "render") {
        if (message.id !== latestRenderId) return;
        const pixels = render_rows_normalized(
          message.profile,
          message.j,
          message.width,
          message.height,
          message.yStart,
          message.yEnd,
          message.displayP3,
        );
        workerScope.postMessage(
          {
            kind: "render",
            id: message.id,
            profile: message.profile,
            width: message.width,
            height: message.height,
            yStart: message.yStart,
            pixels,
          },
          [pixels.buffer as ArrayBuffer],
        );
        return;
      }
      if (message.kind === "evaluate") {
        if (message.id !== latestEvaluateId) return;
        const values = evaluate_normalized(
          message.profile,
          message.j,
          message.saturationX,
          message.saturationY,
          message.background,
        );
        workerScope.postMessage({
          kind: "evaluate",
          id: message.id,
          profile: message.profile,
          j: message.j,
          saturationX: message.saturationX,
          saturationY: message.saturationY,
          background: message.background,
          values,
        });
        return;
      }
      if (message.kind === "colorchecker") {
        if (message.id !== latestColorcheckerId) return;
        workerScope.postMessage({
          kind: "colorchecker",
          id: message.id,
          profile: message.profile,
          points: colorchecker_points_normalized(message.profile),
        });
        return;
      }
      if (message.kind === "set") {
        if (message.id !== latestSetId) return;
        const values =
          message.linear && message.sourceProfile !== undefined
            ? convert_normalized_profile(
                message.sourceProfile,
                message.profile,
                message.red,
                message.green,
                message.blue,
              )
            : message.acescg
              ? normalized_coordinates_from_acescg(
                  message.profile,
                  message.red,
                  message.green,
                  message.blue,
                )
              : normalized_coordinates_from_encoded(
                  message.profile,
                  message.red,
                  message.green,
                  message.blue,
                );
        const convertedBackground =
          message.linear &&
          message.sourceProfile !== undefined &&
          message.sourceJ !== undefined &&
          message.background !== undefined &&
          values.length >= 2
            ? convert_normalized_background(
                message.sourceProfile,
                message.profile,
                message.background,
                message.sourceJ,
                values[1],
              )
            : undefined;
        workerScope.postMessage({
          kind: "set",
          id: message.id,
          profile: message.profile,
          values,
          background: convertedBackground?.[1],
          backgroundPreserved: convertedBackground
            ? convertedBackground[0] > 0.5
            : false,
        });
      }
    })
    .catch(() => reportError(message));
};
