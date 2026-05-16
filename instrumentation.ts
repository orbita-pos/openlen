import "@inariwatch/capture/auto";
import { captureRequestError } from "@inariwatch/capture";

export const onRequestError = captureRequestError;

export async function register() {
  // @inariwatch/capture/auto initialized via side-effect import above.
}
